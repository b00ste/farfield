// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

interface IERC20RF {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IGenerationsRF {
    function ownerOf(uint256 id) external view returns (address);
    function generation(uint256 id) external view returns (uint8);
    function tokenBoundAccount(uint256 id) external view returns (address);
}

/// @notice Fixed 1 RF, two-player matches. The immutable referee is trusted to report gameplay results.
/// @dev Player deposits fund the pool. No admin withdrawal, fees, upgrades, or outcome randomness.
contract FarfieldEscrow {
    address public constant RF = 0x0779369854d3EcdEA927206718FFD7730C67B71f;
    address public constant GENERATIONS = 0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D;
    uint256 public constant ENTRY = 1 ether;
    uint256 public constant FUNDING_WINDOW = 10 minutes;
    uint256 public constant RESULT_WINDOW = 45 minutes;
    address public immutable referee;
    enum Stage {
        Missing,
        Funding,
        Active,
        Settled,
        Refunding
    }

    struct Match {
        address[2] players;
        uint256[2] friends;
        bool[2] deposited;
        bool[2] claimed;
        uint64 fundBy;
        uint64 resolveBy;
        Stage stage;
        address winner;
    }
    mapping(bytes32 => Match) private matches;
    bool private entered;
    event MatchCreated(
        bytes32 indexed id,
        address indexed player0,
        address indexed player1,
        uint256 friend0,
        uint256 friend1,
        uint64 fundBy
    );
    event Deposited(bytes32 indexed id, address indexed player);
    event Activated(bytes32 indexed id, uint64 resolveBy);
    event Result(bytes32 indexed id, address indexed winner);
    event Paid(bytes32 indexed id, address indexed player, uint256 amount, bool refund);
    modifier nonReentrant() {
        require(!entered, "Reentrant");
        entered = true;
        _;
        entered = false;
    }
    modifier onlyReferee() {
        require(msg.sender == referee, "Only referee");
        _;
    }

    constructor(address referee_) {
        require(block.chainid == 4663, "Robinhood only");
        require(referee_ != address(0), "Zero referee");
        referee = referee_;
    }

    function createMatch(bytes32 id, address a, address b, uint256 friendA, uint256 friendB) external onlyReferee {
        require(id != bytes32(0) && matches[id].stage == Stage.Missing, "Match exists");
        require(a != address(0) && b != address(0) && a != b && friendA != friendB, "Distinct players required");
        Match storage m = matches[id];
        m.players = [a, b];
        m.friends = [friendA, friendB];
        m.fundBy = uint64(block.timestamp + FUNDING_WINDOW);
        m.stage = Stage.Funding;
        emit MatchCreated(id, a, b, friendA, friendB, m.fundBy);
    }

    function deposit(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.stage == Stage.Funding && block.timestamp < m.fundBy, "Funding closed");
        uint256 i = indexOf(m, msg.sender);
        require(!m.deposited[i], "Already deposited");
        IGenerationsRF generations = IGenerationsRF(GENERATIONS);
        require(
            generations.ownerOf(m.friends[i]) == msg.sender && generations.generation(m.friends[i]) >= 1
                && generations.tokenBoundAccount(m.friends[i]) != address(0),
            "Ineligible Friend"
        );
        m.deposited[i] = true;
        uint256 beforeBalance = IERC20RF(RF).balanceOf(address(this));
        require(IERC20RF(RF).transferFrom(msg.sender, address(this), ENTRY), "Transfer failed");
        require(IERC20RF(RF).balanceOf(address(this)) == beforeBalance + ENTRY, "Exact RF required");
        emit Deposited(id, msg.sender);
        if (m.deposited[0] && m.deposited[1]) {
            m.stage = Stage.Active;
            m.resolveBy = uint64(block.timestamp + RESULT_WINDOW);
            emit Activated(id, m.resolveBy);
        }
    }

    function settle(bytes32 id, address winner) external onlyReferee {
        Match storage m = matches[id];
        require(m.stage == Stage.Active && block.timestamp < m.resolveBy, "Result closed");
        indexOf(m, winner);
        m.winner = winner;
        m.stage = Stage.Settled;
        emit Result(id, winner);
    }

    /// @notice Players may concede directly without depending on the referee server.
    function forfeit(bytes32 id) external {
        Match storage m = matches[id];
        require(m.stage == Stage.Active && block.timestamp < m.resolveBy, "Match not active");
        uint256 i = indexOf(m, msg.sender);
        m.winner = m.players[1 - i];
        m.stage = Stage.Settled;
        emit Result(id, m.winner);
    }

    /// @notice Pull the 2 RF winner payout or reclaim your own 1 RF after a timeout.
    function claim(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        uint256 i = indexOf(m, msg.sender);
        if (
            (m.stage == Stage.Funding && block.timestamp >= m.fundBy)
                || (m.stage == Stage.Active && block.timestamp >= m.resolveBy)
        ) m.stage = Stage.Refunding;
        require(m.deposited[i] && !m.claimed[i], "Nothing to claim");
        bool refund = m.stage == Stage.Refunding;
        require(refund || (m.stage == Stage.Settled && m.winner == msg.sender), "No payout available");
        m.claimed[i] = true;
        uint256 amount = refund ? ENTRY : ENTRY * 2;
        require(IERC20RF(RF).transfer(msg.sender, amount), "Transfer failed");
        emit Paid(id, msg.sender, amount, refund);
    }

    function getMatch(bytes32 id)
        external
        view
        returns (
            address a,
            address b,
            uint64 fundBy,
            uint64 resolveBy,
            uint8 stage,
            bool fundedA,
            bool fundedB,
            address winner
        )
    {
        Match storage m = matches[id];
        return (
            m.players[0], m.players[1], m.fundBy, m.resolveBy, uint8(m.stage), m.deposited[0], m.deposited[1], m.winner
        );
    }

    function claimable(bytes32 id, address player) external view returns (uint256) {
        Match storage m = matches[id];
        if (player != m.players[0] && player != m.players[1]) return 0;
        uint256 i = player == m.players[0] ? 0 : 1;
        if (!m.deposited[i] || m.claimed[i]) return 0;
        if (
            m.stage == Stage.Refunding || (m.stage == Stage.Funding && block.timestamp >= m.fundBy)
                || (m.stage == Stage.Active && block.timestamp >= m.resolveBy)
        ) return ENTRY;
        if (m.stage == Stage.Settled && m.winner == player) return ENTRY * 2;
        return 0;
    }

    function indexOf(Match storage m, address player) private view returns (uint256) {
        require(player != address(0) && (player == m.players[0] || player == m.players[1]), "Not a player");
        return player == m.players[0] ? 0 : 1;
    }
}
