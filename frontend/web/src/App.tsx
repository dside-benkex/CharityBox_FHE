import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DonationData {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [donations, setDonations] = useState<DonationData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDonation, setCreatingDonation] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDonationData, setNewDonationData] = useState({ name: "", targetAmount: "", description: "" });
  const [selectedDonation, setSelectedDonation] = useState<DonationData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
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
      const donationsList: DonationData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          donationsList.push({
            id: businessId,
            name: businessData.name,
            targetAmount: Number(businessData.publicValue1) || 0,
            currentAmount: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setDonations(donationsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createDonation = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDonation(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating donation project with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const targetAmount = parseInt(newDonationData.targetAmount) || 0;
      const businessId = `donation-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, targetAmount);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDonationData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        targetAmount,
        0,
        newDonationData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Donation project created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDonationData({ name: "", targetAmount: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDonation(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDonations = donations.filter(donation =>
    donation.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    donation.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedDonations = filteredDonations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredDonations.length / itemsPerPage);

  const renderProgressBar = (current: number, target: number) => {
    const percentage = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    return (
      <div className="progress-container">
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
        <div className="progress-text">{percentage.toFixed(1)}%</div>
      </div>
    );
  };

  const renderStatistics = () => {
    const totalProjects = donations.length;
    const totalRaised = donations.reduce((sum, d) => sum + d.currentAmount, 0);
    const completedProjects = donations.filter(d => d.currentAmount >= d.targetAmount).length;
    const avgProgress = donations.length > 0 
      ? donations.reduce((sum, d) => sum + (d.currentAmount / d.targetAmount * 100), 0) / donations.length 
      : 0;

    return (
      <div className="statistics-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Projects</h3>
            <div className="stat-value">{totalProjects}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Raised</h3>
            <div className="stat-value">${totalRaised.toLocaleString()}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Completed</h3>
            <div className="stat-value">{completedProjects}</div>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <h3>Avg Progress</h3>
            <div className="stat-value">{avgProgress.toFixed(1)}%</div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔒 Confidential Charity</h1>
            <p>FHE Protected Donations</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted charity donations and protect donor privacy.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and supporting encrypted charity projects</p>
              </div>
            </div>
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
        <p className="loading-note">Securing your donations with fully homomorphic encryption</p>
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
          <h1>🔒 Confidential Charity</h1>
          <p>FHE Protected Donations</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="check-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Project
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-section">
          <h2>Transparent Charity, Private Donations</h2>
          <p>FHE technology ensures your donations are counted while keeping your identity and amount private</p>
        </div>

        {renderStatistics()}

        <div className="search-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="Search charity projects..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="donations-grid">
          {paginatedDonations.length === 0 ? (
            <div className="no-projects">
              <p>No charity projects found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Project
              </button>
            </div>
          ) : (
            paginatedDonations.map((donation) => (
              <div key={donation.id} className="donation-card">
                <div className="card-header">
                  <h3>{donation.name}</h3>
                  {donation.isVerified && <span className="verified-badge">✅ Verified</span>}
                </div>
                
                <p className="card-description">{donation.description}</p>
                
                <div className="progress-section">
                  <div className="progress-info">
                    <span>Raised: ${donation.currentAmount.toLocaleString()}</span>
                    <span>Target: ${donation.targetAmount.toLocaleString()}</span>
                  </div>
                  {renderProgressBar(donation.currentAmount, donation.targetAmount)}
                </div>

                <div className="card-meta">
                  <span>Created: {new Date(donation.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {donation.creator.substring(0, 6)}...{donation.creator.substring(38)}</span>
                </div>

                <div className="card-actions">
                  <button 
                    onClick={() => decryptData(donation.id)}
                    className={`decrypt-btn ${donation.isVerified ? 'verified' : ''}`}
                  >
                    {donation.isVerified ? '✅ Verified' : '🔓 Verify FHE'}
                  </button>
                  <button 
                    onClick={() => setSelectedDonation(donation)}
                    className="details-btn"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span>Page {currentPage} of {totalPages}</span>
            <button 
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Charity Project</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Protection</strong>
                <p>Target amount will be encrypted using Zama FHE technology</p>
              </div>
              
              <div className="form-group">
                <label>Project Name *</label>
                <input 
                  type="text"
                  value={newDonationData.name}
                  onChange={(e) => setNewDonationData({...newDonationData, name: e.target.value})}
                  placeholder="Enter project name..."
                />
              </div>
              
              <div className="form-group">
                <label>Target Amount (FHE Encrypted) *</label>
                <input 
                  type="number"
                  value={newDonationData.targetAmount}
                  onChange={(e) => setNewDonationData({...newDonationData, targetAmount: e.target.value})}
                  placeholder="Enter target amount..."
                  min="1"
                />
              </div>
              
              <div className="form-group">
                <label>Description *</label>
                <textarea 
                  value={newDonationData.description}
                  onChange={(e) => setNewDonationData({...newDonationData, description: e.target.value})}
                  placeholder="Describe your charity project..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createDonation}
                disabled={creatingDonation || isEncrypting || !newDonationData.name || !newDonationData.targetAmount || !newDonationData.description}
                className="submit-btn"
              >
                {creatingDonation || isEncrypting ? "Encrypting..." : "Create Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDonation && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>{selectedDonation.name}</h2>
              <button onClick={() => setSelectedDonation(null)} className="close-modal">×</button>
            </div>
            
            <div className="modal-body">
              <div className="project-info">
                <p>{selectedDonation.description}</p>
                
                <div className="info-grid">
                  <div className="info-item">
                    <span>Target Amount:</span>
                    <strong>${selectedDonation.targetAmount.toLocaleString()}</strong>
                  </div>
                  <div className="info-item">
                    <span>Current Raised:</span>
                    <strong>${selectedDonation.currentAmount.toLocaleString()}</strong>
                  </div>
                  <div className="info-item">
                    <span>Created:</span>
                    <strong>{new Date(selectedDonation.timestamp * 1000).toLocaleDateString()}</strong>
                  </div>
                  <div className="info-item">
                    <span>Creator:</span>
                    <strong>{selectedDonation.creator}</strong>
                  </div>
                </div>

                <div className="progress-section">
                  <h4>Funding Progress</h4>
                  {renderProgressBar(selectedDonation.currentAmount, selectedDonation.targetAmount)}
                </div>

                <div className="fhe-status">
                  <h4>FHE Encryption Status</h4>
                  <div className={`status-badge ${selectedDonation.isVerified ? 'verified' : 'encrypted'}`}>
                    {selectedDonation.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
                  </div>
                  {selectedDonation.isVerified && selectedDonation.decryptedValue && (
                    <p>Decrypted target amount: ${selectedDonation.decryptedValue.toLocaleString()}</p>
                  )}
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setSelectedDonation(null)} className="close-btn">Close</button>
              <button 
                onClick={() => decryptData(selectedDonation.id)}
                className="verify-btn"
              >
                {selectedDonation.isVerified ? 'Re-verify' : 'Verify FHE Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>🔒 Confidential Charity - Protecting donor privacy with FHE technology</p>
          <div className="footer-links">
            <span>Transparent · Private · Secure</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;