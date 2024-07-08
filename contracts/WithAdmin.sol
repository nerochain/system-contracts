// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;
/*
    Provides support and utilities for contract administration
*/
contract WithAdmin {
    address public admin; // Administrator. It's better a DAO (or a multiSigWallet).
    address public pendingAdmin; // New admin waiting to accept.

    event AdminChanging(address indexed newAdmin);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "E02");
        _;
    }

    function changeAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;

        emit AdminChanging(newAdmin);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingAdmin, "E03");

        emit AdminChanged(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }
}
