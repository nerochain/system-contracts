// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

// enum for validator state
    enum State {
        Idle,
        Ready,
        Jail,
        Exit
    }
// enum to showing what ranking operation should be done
    enum RankingOp {
        Noop,
        Up,
        Down,
        Remove
    }
