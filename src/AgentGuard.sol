// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Interface minimale ERC-20 (USDC sur Arc : 6 décimales).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentGuard — un garde-fou onchain pour les agents autonomes
/// @notice Le propriétaire (un humain) dépose des USDC et fixe une politique :
///         plafond par transaction, plafond par jour, liste blanche de
///         destinataires, date d'expiration. L'agent désigné ne peut dépenser
///         qu'à l'intérieur de ce cadre. Toute sortie du cadre revert ONCHAIN :
///         ce n'est pas une promesse tenue par le prompt de l'agent, c'est la
///         chaîne qui refuse. Le propriétaire révoque l'agent en un appel.
contract AgentGuard {
    IERC20 public immutable usdc;
    address public owner;
    address public agent;

    uint256 public maxPerTx;
    uint256 public maxPerDay;
    uint256 public spentToday;
    uint256 public dayStart;
    uint256 public expiresAt;
    bool public allowlistOnly;
    mapping(address => bool) public allowed;

    event Deposited(address indexed from, uint256 amount);
    event PolicySet(uint256 maxPerTx, uint256 maxPerDay, uint256 expiresAt, bool allowlistOnly);
    event AgentSet(address indexed agent);
    event Spent(address indexed agent, address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error NotAgent();
    error Expired();
    error OverPerTx(uint256 amount, uint256 limit);
    error OverPerDay(uint256 amount, uint256 remaining);
    error RecipientNotAllowed(address to);
    error ZeroAddress();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdc, address _owner) {
        if (_usdc == address(0) || _owner == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        owner = _owner;
        dayStart = block.timestamp;
    }

    /// @notice Approvisionne le coffre (l'appelant doit avoir approuvé ce contrat).
    function deposit(uint256 amount) external {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Deposited(msg.sender, amount);
    }

    function setPolicy(uint256 _maxPerTx, uint256 _maxPerDay, uint256 _expiresAt, bool _allowlistOnly)
        external
        onlyOwner
    {
        maxPerTx = _maxPerTx;
        maxPerDay = _maxPerDay;
        expiresAt = _expiresAt;
        allowlistOnly = _allowlistOnly;
        emit PolicySet(_maxPerTx, _maxPerDay, _expiresAt, _allowlistOnly);
    }

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    /// @notice Révoquer l'agent : un seul appel, tout pouvoir supprimé.
    function revoke() external onlyOwner {
        agent = address(0);
        emit AgentSet(address(0));
    }

    function setAllowed(address to, bool ok) external onlyOwner {
        allowed[to] = ok;
    }

    /// @notice Le seul chemin de dépense pour l'agent. Tout écart revert.
    function spend(address to, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        if (expiresAt != 0 && block.timestamp > expiresAt) revert Expired();
        if (allowlistOnly && !allowed[to]) revert RecipientNotAllowed(to);
        if (amount > maxPerTx) revert OverPerTx(amount, maxPerTx);

        _rollDay();
        uint256 remaining = maxPerDay > spentToday ? maxPerDay - spentToday : 0;
        if (amount > remaining) revert OverPerDay(amount, remaining);

        spentToday += amount;
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Spent(msg.sender, to, amount);
    }

    function remainingToday() external view returns (uint256) {
        uint256 s = spentToday;
        if (block.timestamp >= dayStart + 1 days) s = 0;
        return maxPerDay > s ? maxPerDay - s : 0;
    }

    /// @notice Le propriétaire récupère tout, même agent actif.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    function _rollDay() internal {
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = block.timestamp;
            spentToday = 0;
        }
    }
}