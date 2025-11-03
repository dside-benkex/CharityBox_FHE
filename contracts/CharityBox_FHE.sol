pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CharityBox_FHE is ZamaEthereumConfig {
    struct Donation {
        euint32 encryptedAmount;
        address donor;
        uint256 timestamp;
        bool isVerified;
        uint32 decryptedAmount;
    }

    struct CharityProject {
        string projectId;
        string name;
        string description;
        uint256 fundingGoal;
        uint256 publicTotal;
        uint256 donationCount;
        mapping(uint256 => Donation) donations;
    }

    mapping(string => CharityProject) public projects;
    string[] public projectIds;

    event ProjectCreated(string indexed projectId, address indexed creator);
    event DonationAdded(string indexed projectId, address indexed donor);
    event DecryptionVerified(string indexed projectId, uint256 donationIndex, uint32 amount);

    constructor() ZamaEthereumConfig() {}

    function createProject(
        string calldata projectId,
        string calldata name,
        string calldata description,
        uint256 fundingGoal
    ) external {
        require(bytes(projects[projectId].name).length == 0, "Project already exists");
        
        projects[projectId].projectId = projectId;
        projects[projectId].name = name;
        projects[projectId].description = description;
        projects[projectId].fundingGoal = fundingGoal;
        projects[projectId].publicTotal = 0;
        projects[projectId].donationCount = 0;

        projectIds.push(projectId);
        emit ProjectCreated(projectId, msg.sender);
    }

    function donate(
        string calldata projectId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(bytes(projects[projectId].name).length > 0, "Project does not exist");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, inputProof)), "Invalid encrypted input");

        uint256 index = projects[projectId].donationCount;
        projects[projectId].donations[index].encryptedAmount = FHE.fromExternal(encryptedAmount, inputProof);
        projects[projectId].donations[index].donor = msg.sender;
        projects[projectId].donations[index].timestamp = block.timestamp;
        projects[projectId].donations[index].isVerified = false;
        projects[projectId].donationCount++;

        FHE.allowThis(projects[projectId].donations[index].encryptedAmount);
        FHE.makePubliclyDecryptable(projects[projectId].donations[index].encryptedAmount);

        emit DonationAdded(projectId, msg.sender);
    }

    function verifyDonation(
        string calldata projectId,
        uint256 donationIndex,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(projects[projectId].name).length > 0, "Project does not exist");
        require(donationIndex < projects[projectId].donationCount, "Invalid donation index");
        require(!projects[projectId].donations[donationIndex].isVerified, "Donation already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(projects[projectId].donations[donationIndex].encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedAmount = abi.decode(abiEncodedClearValue, (uint32));
        projects[projectId].donations[donationIndex].decryptedAmount = decodedAmount;
        projects[projectId].donations[donationIndex].isVerified = true;
        projects[projectId].publicTotal += decodedAmount;

        emit DecryptionVerified(projectId, donationIndex, decodedAmount);
    }

    function getProjectInfo(string calldata projectId) external view returns (
        string memory name,
        string memory description,
        uint256 fundingGoal,
        uint256 publicTotal,
        uint256 donationCount
    ) {
        require(bytes(projects[projectId].name).length > 0, "Project does not exist");
        CharityProject storage project = projects[projectId];
        return (project.name, project.description, project.fundingGoal, project.publicTotal, project.donationCount);
    }

    function getDonation(string calldata projectId, uint256 donationIndex) external view returns (
        euint32 encryptedAmount,
        address donor,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedAmount
    ) {
        require(bytes(projects[projectId].name).length > 0, "Project does not exist");
        require(donationIndex < projects[projectId].donationCount, "Invalid donation index");
        
        Donation storage donation = projects[projectId].donations[donationIndex];
        return (donation.encryptedAmount, donation.donor, donation.timestamp, donation.isVerified, donation.decryptedAmount);
    }

    function getAllProjectIds() external view returns (string[] memory) {
        return projectIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

