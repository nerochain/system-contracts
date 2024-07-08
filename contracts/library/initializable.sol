// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

abstract contract Initializable {
    bool public initialized;

    modifier initializer() {
        require(!initialized, "E41");
        initialized = true;
        _;
    }

    modifier onlyInitialized() {
        require(initialized, "E42");
        _;
    }

}