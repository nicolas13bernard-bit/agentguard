// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentGuard} from "../src/AgentGuard.sol";

/// @notice Faux USDC (6 décimales), suffisant pour tester les règles.
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "solde");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "solde");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgentGuardTest is Test {
    MockUSDC usdc;
    AgentGuard guard;

    address owner = address(0xA11CE);
    address agent = address(0xB0B);
    address marchand = address(0xC0FFEE);
    address inconnu = address(0xDEAD);

    uint256 constant U = 1e6; // 1 USDC en 6 décimales

    function setUp() public {
        usdc = new MockUSDC();
        guard = new AgentGuard(address(usdc), owner);

        usdc.mint(owner, 1_000 * U);
        usdc.mint(agent, 10 * U);

        vm.startPrank(owner);
        usdc.approve(address(guard), type(uint256).max);
        guard.deposit(100 * U);
        guard.setAgent(agent);
        guard.setAllowed(marchand, true);
        guard.setPolicy(5 * U, 9 * U, 0, true); // max 5/tx, 9/jour, liste blanche
        vm.stopPrank();
    }

    function test_DepotEtSolde() public view {
        assertEq(usdc.balanceOf(address(guard)), 100 * U);
        assertEq(guard.remainingToday(), 9 * U);
    }

    function test_AgentDepenseDansLeCadre() public {
        vm.prank(agent);
        guard.spend(marchand, 3 * U);
        assertEq(usdc.balanceOf(marchand), 3 * U);
        assertEq(guard.remainingToday(), 6 * U);
    }

    function test_RefuseAuDessusDuPlafondParTransaction() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentGuard.OverPerTx.selector, 6 * U, 5 * U));
        guard.spend(marchand, 6 * U);
    }

    function test_RefuseAuDessusDuPlafondJournalier() public {
        vm.startPrank(agent);
        guard.spend(marchand, 5 * U);
        vm.expectRevert(abi.encodeWithSelector(AgentGuard.OverPerDay.selector, 5 * U, 4 * U));
        guard.spend(marchand, 5 * U);
        vm.stopPrank();
    }

    function test_RefuseDestinataireHorsListeBlanche() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentGuard.RecipientNotAllowed.selector, inconnu));
        guard.spend(inconnu, 1 * U);
    }

    function test_RefuseUnAppelantQuiNestPasLAgent() public {
        vm.prank(inconnu);
        vm.expectRevert(AgentGuard.NotAgent.selector);
        guard.spend(marchand, 1 * U);
    }

    function test_RefuseApresExpiration() public {
        vm.prank(owner);
        guard.setPolicy(5 * U, 10 * U, block.timestamp + 1 days, true);

        vm.warp(block.timestamp + 2 days);
        vm.prank(agent);
        vm.expectRevert(AgentGuard.Expired.selector);
        guard.spend(marchand, 1 * U);
    }

    function test_RevocationSupprimeToutPouvoir() public {
        vm.prank(owner);
        guard.revoke();

        vm.prank(agent);
        vm.expectRevert(AgentGuard.NotAgent.selector);
        guard.spend(marchand, 1 * U);
    }

    function test_LePlafondJournalierSeReinitialise() public {
        vm.prank(agent);
        guard.spend(marchand, 5 * U);

        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(agent);
        guard.spend(marchand, 5 * U);
        assertEq(usdc.balanceOf(marchand), 10 * U);
    }

    function test_SeulLeProprietairePeutRetirer() public {
        vm.prank(agent);
        vm.expectRevert(AgentGuard.NotOwner.selector);
        guard.withdraw(agent, 1 * U);

        vm.prank(owner);
        guard.withdraw(owner, 100 * U);
        assertEq(usdc.balanceOf(owner), 1_000 * U);
    }

    function testFuzz_PasDeDepassementPossible(uint256 montant) public {
        montant = bound(montant, 0, 100 * U);
        vm.prank(agent);
        try guard.spend(marchand, montant) {
            assertLe(usdc.balanceOf(marchand), 10 * U);
        } catch {
            assertLe(usdc.balanceOf(marchand), 10 * U);
        }
    }
}