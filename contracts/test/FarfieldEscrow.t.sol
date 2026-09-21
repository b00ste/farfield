// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;
import {FarfieldEscrow} from "../src/FarfieldEscrow.sol";

interface Vm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
}

contract MockRF {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address a, uint256 n) external {
        balanceOf[a] += n;
    }

    function approve(address a, uint256 n) external returns (bool) {
        allowance[msg.sender][a] = n;
        return true;
    }

    function transferFrom(address a, address b, uint256 n) external returns (bool) {
        require(balanceOf[a] >= n && allowance[a][msg.sender] >= n);
        balanceOf[a] -= n;
        allowance[a][msg.sender] -= n;
        balanceOf[b] += n;
        return true;
    }

    function transfer(address b, uint256 n) external returns (bool) {
        require(balanceOf[msg.sender] >= n);
        balanceOf[msg.sender] -= n;
        balanceOf[b] += n;
        return true;
    }
}

contract MockGenerations {
    mapping(uint256 => address) public ownerOf;

    function set(uint256 id, address owner) external {
        ownerOf[id] = owner;
    }

    function generation(uint256) external pure returns (uint8) {
        return 1;
    }

    function tokenBoundAccount(uint256) external pure returns (address) {
        return address(99);
    }
}

contract FarfieldEscrowTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    FarfieldEscrow escrow;
    MockRF rf;
    MockGenerations generations;
    address a = address(11);
    address b = address(22);
    bytes32 id = keccak256("match");

    function setUp() public {
        vm.chainId(4663);
        escrow = new FarfieldEscrow(address(this));
        vm.etch(escrow.RF(), address(new MockRF()).code);
        rf = MockRF(escrow.RF());
        vm.etch(escrow.GENERATIONS(), address(new MockGenerations()).code);
        generations = MockGenerations(escrow.GENERATIONS());
        generations.set(1, a);
        generations.set(2, b);
        rf.mint(a, 10 ether);
        rf.mint(b, 10 ether);
        vm.prank(a);
        rf.approve(address(escrow), 1 ether);
        vm.prank(b);
        rf.approve(address(escrow), 1 ether);
        escrow.createMatch(id, a, b, 1, 2);
    }

    function fund() internal {
        vm.prank(a);
        escrow.deposit(id);
        vm.prank(b);
        escrow.deposit(id);
    }

    function testWinnerTakesExactlyTwoAndCannotClaimTwice() public {
        fund();
        escrow.settle(id, a);
        require(escrow.claimable(id, a) == 2 ether);
        vm.prank(a);
        escrow.claim(id);
        require(rf.balanceOf(a) == 11 ether && rf.balanceOf(b) == 9 ether);
        vm.expectRevert();
        vm.prank(a);
        escrow.claim(id);
        vm.expectRevert();
        vm.prank(b);
        escrow.claim(id);
    }

    function testOneSidedFundingRefund() public {
        vm.prank(a);
        escrow.deposit(id);
        vm.warp(block.timestamp + 601);
        vm.expectRevert();
        vm.prank(b);
        escrow.deposit(id);
        vm.prank(a);
        escrow.claim(id);
        require(rf.balanceOf(a) == 10 ether);
    }

    function testActiveTimeoutRefundsBothRegardlessOfClaimOrder() public {
        fund();
        vm.warp(block.timestamp + 2701);
        vm.expectRevert();
        escrow.settle(id, a);
        vm.prank(b);
        escrow.claim(id);
        vm.prank(a);
        escrow.claim(id);
        require(rf.balanceOf(a) == 10 ether && rf.balanceOf(b) == 10 ether);
    }

    function testUnauthorizedSettlementAndOutsiderPayoutFail() public {
        fund();
        vm.expectRevert();
        vm.prank(a);
        escrow.settle(id, a);
        vm.expectRevert();
        escrow.settle(id, address(33));
        vm.expectRevert();
        vm.prank(address(33));
        escrow.claim(id);
    }

    function testForfeitLetsOtherPlayerClaimWithoutReferee() public {
        fund();
        vm.prank(a);
        escrow.forfeit(id);
        vm.prank(b);
        escrow.claim(id);
        require(rf.balanceOf(b) == 11 ether);
    }

    function testFreshOwnershipRequiredAtDeposit() public {
        generations.set(1, b);
        vm.expectRevert();
        vm.prank(a);
        escrow.deposit(id);
        require(rf.balanceOf(a) == 10 ether);
    }

    function testNoDuplicateDepositsOrIdsOrEarlyClaims() public {
        vm.expectRevert();
        escrow.createMatch(id, a, b, 1, 2);
        vm.prank(a);
        escrow.deposit(id);
        vm.expectRevert();
        vm.prank(a);
        escrow.deposit(id);
        vm.expectRevert();
        vm.prank(a);
        escrow.claim(id);
        require(rf.balanceOf(address(escrow)) == 1 ether);
    }

    function testNonRefereeCannotCreateOrSamePlayerJoin() public {
        vm.expectRevert();
        vm.prank(a);
        escrow.createMatch(bytes32(uint256(2)), a, b, 1, 2);
        vm.expectRevert();
        escrow.createMatch(bytes32(uint256(2)), a, a, 1, 2);
    }
}
