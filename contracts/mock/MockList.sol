// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "../interfaces/IValidator.sol";
import "../library/SortedList.sol";

/**
    MockList is used for testing the SortedLinkedList
*/
contract MockList {
    using SortedLinkedList for SortedLinkedList.List;

    SortedLinkedList.List public list;

    function improveRanking(IValidator _value) external {
        list.improveRanking(_value);
    }

    function lowerRanking(IValidator _value) external {
        list.lowerRanking(_value);
    }

    function removeRanking(IValidator _value) external {
        list.removeRanking(_value);
    }

    function prev(IValidator _value) view external returns(IValidator){
        return list.prev[_value];
    }

    function next(IValidator _value) view external returns(IValidator){
        return list.next[_value];
    }

    function clear() external {
        IValidator _tail = list.tail;

        while(_tail != IValidator(address(0))) {
            IValidator _prev = list.prev[_tail];
            list.removeRanking(_tail);
            _tail = _prev;
        }
    }

}
