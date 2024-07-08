// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "./types.sol";

interface IValidator {
    function state() external view returns (State);

    function validator() external view returns (address);

    function manager() external view returns (address);

    function totalStake() external view returns (uint);

    function addStake(uint256 _stakeGWei) external payable returns (RankingOp);

    function subStake(uint256 _stakeGWei) external payable returns (RankingOp);

    // @return RankingOp
    // @return amount of stakes need to be subtracted from total stakes.
    function exitStaking() external payable returns (RankingOp, uint256);

    // validator receive fee rewards
    function receiveFee() external payable;

    // @dev validatorClaimAny will sends any rewards to the manager,
    //  and returns an amount of ethers that the Staking contract should send back to the manager.
    // @return an amount of ethers that the Staking contract should send back to the manager.
    function validatorClaimAny(address payable _recipient) external payable returns (uint256 _stakeGWei);

    function addDelegation(uint256 _stakeGWei, address _delegator) external payable returns (RankingOp);

    function subDelegation(uint256 _stakeGWei, address _delegator) external payable returns (RankingOp);

    function exitDelegation(address _delegator) external payable returns (RankingOp, uint256);

    function delegatorClaimAny(address payable _delegator) external payable returns (uint256 _stakeGWei, uint256 _forceUnbound);

    function anyClaimable(uint _unsettledRewards, address _stakeOwner) external view returns (uint);

    function claimableRewards(uint _unsettledRewards, address _stakeOwner) external view returns (uint);

    function punish(uint _factor) external payable ;

}


