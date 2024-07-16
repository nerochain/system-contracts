// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "../interfaces/IValidator.sol";
import "../WithAdmin.sol";
import "../interfaces/types.sol";


contract Validator is WithAdmin, IValidator {

    address public owner;   // It must be the Staking contract address. For convenient.
    address public override validator; // the address that represents a validator and will be used to take part in the consensus.
    uint256 public commissionRate; // base 100
    uint256 public selfStakeGWei; // self stake, in GWei
    uint256 public override totalStake; // total stakes in GWei, = selfStake + allOtherDelegation
    bool public acceptDelegation; // Does this validator accepts delegation
    State public override state;
    uint256 public totalUnWithdrawn;

    // A valid commission rate must in the range [0,100]
    modifier onlyValidRate(uint _rate) {
        require(_rate <= 100, "E27");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "E01");
        _;
    }

    // @param _stake, the staking amount of ether
    constructor(address _validator, address _manager, uint _rate, uint _stake, bool _acceptDlg, State _state)
    onlyValidRate(_rate) {
        owner = msg.sender;
        validator = _validator;
        admin = _manager;
        commissionRate = _rate;
        selfStakeGWei = _stake;
        totalStake = _stake;
        totalUnWithdrawn = _stake;
        acceptDelegation = _acceptDlg;
        state = _state;
    }

    function manager() external override view returns (address) {
        return admin;
    }

    // @notice The founder locking rule is handled by Staking contract, not in here.
    // @return an operation enum about the ranking
    function addStake(uint256 ) external override payable onlyOwner  returns (RankingOp) {

        return RankingOp.Noop;
    }

    // @notice The founder locking rule is handled by Staking contract, not in here.
    // @return an operation enum about the ranking
    function subStake(uint256, bool) external override payable onlyOwner  returns (RankingOp){
        return RankingOp.Noop;

    }

    function exitStaking() external override payable onlyOwner returns (RankingOp, uint256) {
        return (RankingOp.Noop, 0);
    }

    function validatorClaimAny(address payable ) external override payable onlyOwner returns (uint256 _stake) {

        return 0;
    }

    function addDelegation(uint256 , address ) external override payable onlyOwner  returns (RankingOp){

        return RankingOp.Noop;
    }

    function subDelegation(uint256 , address, bool) external override payable onlyOwner  returns (RankingOp){
        return RankingOp.Noop;

    }

    function exitDelegation(address ) external override payable onlyOwner  returns (RankingOp, uint){
        return (RankingOp.Noop,0);

    }

    function delegatorClaimAny(address payable ) external override payable onlyOwner returns (uint256 , uint256 ) {
        return (0,0);
    }

    function anyClaimable(uint , address ) external override view onlyOwner returns (uint) {
        return 0;
    }
    function claimableRewards(uint , address ) external override view onlyOwner returns (uint) {
        return 0;
    }

    function punish(uint ) external payable override onlyOwner {

    }

    // functions for testcase
    function changeStakes(uint _stake) public {
        totalStake = _stake;
    }

}