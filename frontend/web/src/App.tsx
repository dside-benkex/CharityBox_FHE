import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DonationProject {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedAmount?: number;
  encryptedValueHandle?: string;
}

interface DonationStats {
  totalProjects: number;
  totalDonations: number;
  verifiedProjects: number;
  avgDonation: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<DonationProject[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newProjectData, setNewProjectData] = useState({ name: "", targetAmount: "", description: "" });
  const [selectedProject, setSelectedProject] = useState<DonationProject | null>(null);
  const [userHistory, setUserHistory] = useState<DonationProject[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const projectsList: DonationProject[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          projectsList.push({
            id: businessId,
            name: businessData.name,
            targetAmount: Number(businessData.publicValue1) || 1000,
            currentAmount: 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedAmount: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading project data:', e);
        }
      }
      
      setProjects(projectsList);
      if (address) {
        const userProjects = projectsList.filter(p => p.creator.toLowerCase() === address.toLowerCase());
        setUserHistory(userProjects);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createProject = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingProject(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating project with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const initialDonation = 100;
      const businessId = `charity-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, initialDonation);
      
      const tx = await contract.createBusinessData(
        businessId,
        newProjectData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newProjectData.targetAmount) || 1000,
        0,
        newProjectData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Project created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewProjectData({ name: "", targetAmount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingProject(false); 
    }
  };

  const donateToProject = async (projectId: string, amount: number) => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted donation..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const encryptedResult = await encrypt(contractAddress, address, amount);
      const businessId = `donation-${projectId}-${Date.now()}`;
      
      const tx = await contract.createBusinessData(
        businessId,
        `Donation to ${projects.find(p => p.id === projectId)?.name}`,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amount,
        0,
        `Encrypted donation of ${amount}`
      );
      
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Donation completed with FHE protection!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Donation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptProjectAmount = async (projectId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(projectId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(projectId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(projectId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Amount decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        const result = await contract.isAvailable();
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const getDonationStats = (): DonationStats => {
    const totalProjects = projects.length;
    const verifiedProjects = projects.filter(p => p.isVerified).length;
    const totalDonations = projects.reduce((sum, p) => sum + (p.decryptedAmount || 0), 0);
    const avgDonation = totalProjects > 0 ? totalDonations / totalProjects : 0;
    
    return { totalProjects, totalDonations, verifiedProjects, avgDonation };
  };

  const renderStats = () => {
    const stats = getDonationStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card metal-card">
          <div className="stat-icon">📊</div>
          <div className="stat-value">{stats.totalProjects}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-card metal-card">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{stats.totalDonations}</div>
          <div className="stat-label">Total Donations</div>
        </div>
        <div className="stat-card metal-card">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{stats.verifiedProjects}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-card metal-card">
          <div className="stat-icon">📈</div>
          <div className="stat-value">{stats.avgDonation.toFixed(0)}</div>
          <div className="stat-label">Avg Donation</div>
        </div>
      </div>
    );
  };

  const renderProgressChart = (project: DonationProject) => {
    const progress = project.isVerified ? 
      Math.min(100, ((project.decryptedAmount || 0) / project.targetAmount) * 100) : 50;
    
    return (
      <div className="progress-chart">
        <div className="progress-header">
          <span>Funding Progress</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <div className="progress-labels">
          <span>0</span>
          <span>Target: {project.targetAmount}</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CharityBox FHE 🔐</h1>
            <p>Privacy-First Charity Donations</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Experience fully encrypted charity donations with FHE technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted charity system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CharityBox FHE 🔐</h1>
          <p>Encrypted Donations • Transparent Impact</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">Test Contract</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Project</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-section">
          <h2>Charity Statistics</h2>
          {renderStats()}
        </div>
        
        <div className="projects-section">
          <div className="section-header">
            <h2>Active Charity Projects</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="projects-grid">
            {projects.length === 0 ? (
              <div className="no-projects">
                <p>No charity projects found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Project
                </button>
              </div>
            ) : projects.map((project) => (
              <div className="project-card metal-card" key={project.id}>
                <div className="card-header">
                  <h3>{project.name}</h3>
                  <span className={`status-badge ${project.isVerified ? 'verified' : 'encrypted'}`}>
                    {project.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                  </span>
                </div>
                
                <p className="project-description">{project.description}</p>
                
                {renderProgressChart(project)}
                
                <div className="card-actions">
                  <button 
                    onClick={() => donateToProject(project.id, 100)}
                    className="donate-btn"
                  >
                    Donate 100
                  </button>
                  <button 
                    onClick={() => decryptProjectAmount(project.id)}
                    className="decrypt-btn"
                  >
                    {project.isVerified ? 'View Amount' : 'Decrypt'}
                  </button>
                </div>
                
                <div className="card-footer">
                  <span>By: {project.creator.substring(0, 6)}...{project.creator.substring(38)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="history-section">
          <h2>Your Donation History</h2>
          <div className="history-list">
            {userHistory.map((project, index) => (
              <div className="history-item metal-card" key={index}>
                <div className="history-info">
                  <strong>{project.name}</strong>
                  <span>{new Date(project.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="history-amount">
                  {project.isVerified ? `Amount: ${project.decryptedAmount}` : 'Amount: 🔒 Encrypted'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal metal-card">
            <div className="modal-header">
              <h2>Create New Charity Project</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Project Name</label>
                <input 
                  type="text" 
                  value={newProjectData.name}
                  onChange={(e) => setNewProjectData({...newProjectData, name: e.target.value})}
                  placeholder="Enter project name..."
                />
              </div>
              
              <div className="form-group">
                <label>Target Amount</label>
                <input 
                  type="number" 
                  value={newProjectData.targetAmount}
                  onChange={(e) => setNewProjectData({...newProjectData, targetAmount: e.target.value})}
                  placeholder="Enter target amount..."
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newProjectData.description}
                  onChange={(e) => setNewProjectData({...newProjectData, description: e.target.value})}
                  placeholder="Describe your charity project..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createProject} 
                disabled={creatingProject || isEncrypting}
                className="submit-btn"
              >
                {creatingProject || isEncrypting ? "Creating..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

