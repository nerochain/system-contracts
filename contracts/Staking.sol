// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

// #if Mainnet
import "./Params.sol";
// #else
import "./mock/MockParams.sol";
// #endif
import "./interfaces/IValidator.sol";
import "./library/SortedList.sol";
import "./Validator.sol";
import "./WithAdmin.sol";
import "./interfaces/types.sol";
import "./library/initializable.sol";
import "./library/ReentrancyGuard.sol";

contract Staking is Initializable, Params, SafeSend, WithAdmin, ReentrancyGuard {
    using SortedLinkedList for SortedLinkedList.List;

    // ValidatorInfo records necessary information about a validator
    struct ValidatorInfo {
        uint stake; //
        uint debt; // debt for the calculation of staking rewards, enlarged by COEFFICIENT times
        uint incomeFees; // wei
        uint unWithdrawn; // total un-withdrawn stakes, in case the validator need to be punished, the punish amount will calculate according to this.
    }

    struct FounderLock {
        uint initialStake; // total initial stakes
        uint unboundStake; // total unbound stakes
        bool locking; // False means there will be no any locking rule (not a founder, or a founder is totally unlocked)
    }

    struct LazyPunishRecord {
        uint256 missedBlocksCounter;
        uint256 index;
        bool exist;
    }

    enum Operation {
        DistributeFee,
        UpdateValidators,
        UpdateRewardsPerBlock,
        LazyPunish,
        DecreaseMissingBlockCounter
    }

    bool public isOpened; // true means any one can register to be a validator without permission. default: false

    uint256 public basicLockEnd; // End of the locking timestamp for the funding validators.
    uint256 public releasePeriod; // Times of a single release period for the funding validators, such as 30 days
    uint256 public releaseCount; // Release period count, such as 6.

    // validators that can take part in the consensus
    address[] activeValidators;

    address[] public allValidatorAddrs; // all validator addresses, for traversal purpose
    mapping(address => IValidator) public valMaps; // mapping from validator address to validator contract.
    mapping(address => ValidatorInfo) public valInfos; // validator infos for rewards.
    mapping(address => FounderLock) public founders; // founders need to lock its staking
    // A sorted linked list of all valid validators
    SortedLinkedList.List topValidators;

    // staking rewards relative fields
    uint256 public totalStake; // Total stakes.
    uint256 public rewardsPerBlock; // wei
    uint256 public accRewardsPerStake; // accumulative rewards per stake, enlarged by COEFFICIENT times
    uint256 public lastUpdateAccBlock; // block number of last updates to the accRewardsPerStake
    uint256 public totalStakingRewards; // amount of total staking rewards.

    // necessary restriction for the miner to update some consensus relative value
    uint public blockEpoch; //set on initialize,
    mapping(uint256 => mapping(Operation => bool)) operationsDone;

    mapping(address => LazyPunishRecord) lazyPunishRecords;
    address[] public lazyPunishedValidators;

    mapping(bytes32 => bool) public doubleSignPunished;

    event LogDecreaseMissedBlocksCounter();
    event LogLazyPunishValidator(address indexed val, uint256 time);
    event LogDoubleSignPunishValidator(address indexed val, uint256 time);

    event PermissionLess(bool indexed opened);

    // ValidatorRegistered event emits when a new validator registered
    event ValidatorRegistered(
        address indexed val,
        address indexed manager,
        uint256 commissionRate,
        uint256 stake,
        State st
    );
    event TotalStakeChanged(address indexed changer, uint oldStake, uint newStake);
    event FounderUnlocked(address indexed val);
    event StakingRewardsEmpty(bool empty);
    // emits when a user do a claim and with unbound stake be withdrawn.
    event StakeWithdrawn(address indexed val, address indexed recipient, uint amount);
    // emits when a user do a claim and there's no unbound stake need to return.
    event ClaimWithoutUnboundStake(address indexed val);

    modifier onlyNotExists(address _val) {
        require(valMaps[_val] == IValidator(address(0)), "E07");
        _;
    }

    modifier onlyExists(address _val) {
        require(valMaps[_val] != IValidator(address(0)), "E08");
        _;
    }

    modifier onlyExistsAndByManager(address _val) {
        IValidator val = valMaps[_val];
        require(val != IValidator(address(0)), "E08");
        require(val.manager() == msg.sender, "E02");
        _;
    }

    modifier onlyOperateOnce(Operation operation) {
        require(!operationsDone[block.number][operation], "E06");
        operationsDone[block.number][operation] = true;
        _;
    }

    modifier onlyBlockEpoch() {
        require(block.number % blockEpoch == 0, "E17");
        _;
    }

    modifier onlyNotDoubleSignPunished(bytes32 punishHash) {
        require(!doubleSignPunished[punishHash], "E06");
        _;
    }

    // initialize the staking contract, mainly for the convenient purpose to init different chains
    function initialize(
        address _admin,
        uint256 _firstLockPeriod,
        uint256 _releasePeriod,
        uint256 _releaseCnt,
        uint256 _totalRewards,
        uint256 _rewardsPerBlock,
        uint256 _epoch
    )
        external
        payable
        // #if !Mainnet
        // #endif
        initializer
    {
        require(_admin != address(0), "E09");
        require((_releasePeriod != 0 && _releaseCnt != 0) || (_releasePeriod == 0 && _releaseCnt == 0), "E10");
        require(address(this).balance > _totalRewards, "E11");
        require(_epoch > 0, "E12");
        //        require(_rewardsPerBlock > 0, ""); // don't need to restrict
        admin = _admin;
        basicLockEnd = block.timestamp + _firstLockPeriod;
        releasePeriod = _releasePeriod;
        releaseCount = _releaseCnt;
        totalStakingRewards = _totalRewards;
        rewardsPerBlock = _rewardsPerBlock;
        blockEpoch = _epoch;
    }

    // @param _stakes, the staking amount in wei.
    function initValidator(
        address _val,
        address _manager,
        uint _rate,
        uint _stakes,
        bool _acceptDelegation
    ) external onlyInitialized onlyNotExists(_val) {
        // only on genesis block for the chain initialize code to execute
        // #if Mainnet
        require(block.number == 0, "E13");
        // #endif
        // invalid stake
        require(_stakes > 0, "E14");
        mustConvertStake(_stakes);
        uint recordBalance = totalStake + _stakes + totalStakingRewards;
        // invalid initial params
        require(address(this).balance >= recordBalance, "E15");
        // create a funder validator with state of Ready
        IValidator val = new Validator(_val, _manager, _rate, _stakes, _acceptDelegation, State.Ready);
        allValidatorAddrs.push(_val);
        valMaps[_val] = val;
        valInfos[_val] = ValidatorInfo(_stakes, 0, 0, _stakes);
        founders[_val] = FounderLock(_stakes, 0, true);

        totalStake += _stakes;

        topValidators.improveRanking(val);
    }

    //** basic management **

    // @dev removePermission will make the register of new validator become permission-less.
    // can be run only once.
    function removePermission() external onlyAdmin {
        //already permission-less
        require(!isOpened, "E16");
        isOpened = true;
        emit PermissionLess(isOpened);
    }

    // ** end of basic management **

    // ** functions that will be called by the chain-code **

    // @dev the chain-code can call this to get top n validators by totalStakes
    function getTopValidators(uint8 _count) external view returns (address[] memory) {
        // Use default MaxValidators if _count is not provided.
        if (_count == 0) {
            _count = MaxValidators;
        }
        // set max limit: min(_count, list.length)
        if (_count > topValidators.length) {
            _count = topValidators.length;
        }

        address[] memory _topValidators = new address[](_count);

        IValidator cur = topValidators.head;
        for (uint8 i = 0; i < _count; i++) {
            _topValidators[i] = cur.validator();
            cur = topValidators.next[cur];
        }

        return _topValidators;
    }

    function updateActiveValidatorSet(
        address[] memory newSet
    )
        external
        // #if Mainnet
        onlyEngine
        // #endif
        onlyOperateOnce(Operation.UpdateValidators)
        onlyBlockEpoch
    {
        // empty validators set
        require(newSet.length > 0, "E18");
        activeValidators = newSet;
    }

    // distributeBlockFee distributes block fees to all active validators
    function distributeBlockFee()
        external
        payable
        // #if Mainnet
        onlyEngine
        // #endif
        onlyOperateOnce(Operation.DistributeFee)
    {
        if (msg.value > 0) {
            uint cnt = activeValidators.length;
            uint feePerValidator = msg.value / cnt;
            uint remainder = msg.value - (feePerValidator * cnt);
            ValidatorInfo storage aInfo = valInfos[activeValidators[0]];
            aInfo.incomeFees += feePerValidator + remainder;
            for (uint i = 1; i < cnt; i++) {
                ValidatorInfo storage vInfo = valInfos[activeValidators[i]];
                vInfo.incomeFees += feePerValidator;
            }
        }
    }

    function getActiveValidators() external view returns (address[] memory) {
        return activeValidators;
    }

    // @dev punish do a lazy punish to the validator that missing propose a block.
    function lazyPunish(
        address _val
    )
        external
        // #if Mainnet
        onlyEngine
        // #endif
        onlyExists(_val)
        onlyOperateOnce(Operation.LazyPunish)
    {
        if (!lazyPunishRecords[_val].exist) {
            lazyPunishRecords[_val].index = lazyPunishedValidators.length;
            lazyPunishedValidators.push(_val);
            lazyPunishRecords[_val].exist = true;
        }
        lazyPunishRecords[_val].missedBlocksCounter++;

        if (lazyPunishRecords[_val].missedBlocksCounter % LazyPunishThreshold == 0) {
            doSlash(_val, LazyPunishFactor);
            // reset validator's missed blocks counter
            lazyPunishRecords[_val].missedBlocksCounter = 0;
        }

        emit LogLazyPunishValidator(_val, block.timestamp);
    }

    // @dev decreaseMissedBlocksCounter will decrease the missedBlocksCounter at DecreaseRate at each epoch.
    function decreaseMissedBlocksCounter()
        external
        // #if Mainnet
        onlyEngine
        // #endif
        onlyBlockEpoch
        onlyOperateOnce(Operation.DecreaseMissingBlockCounter)
    {
        if (lazyPunishedValidators.length == 0) {
            return;
        }

        uint cnt = lazyPunishedValidators.length;
        for (uint256 i = cnt; i > 0; i--) {
            address _val = lazyPunishedValidators[i - 1];

            if (lazyPunishRecords[_val].missedBlocksCounter > DecreaseRate) {
                lazyPunishRecords[_val].missedBlocksCounter -= DecreaseRate;
            } else {
                if (i != cnt) {
                    // not the last one, swap
                    address tail = lazyPunishedValidators[cnt - 1];
                    lazyPunishedValidators[i - 1] = tail;
                    lazyPunishRecords[tail].index = i - 1;
                }
                // delete the last one
                lazyPunishedValidators.pop();
                lazyPunishRecords[_val].missedBlocksCounter = 0;
                lazyPunishRecords[_val].index = 0;
                lazyPunishRecords[_val].exist = false;
                cnt -= 1;
            }
        }

        emit LogDecreaseMissedBlocksCounter();
    }

    function doubleSignPunish(
        bytes32 _punishHash,
        address _val
    )
        external
        // #if Mainnet
        onlyEngine
        // #endif
        onlyExists(_val)
        onlyNotDoubleSignPunished(_punishHash)
    {
        doubleSignPunished[_punishHash] = true;
        doSlash(_val, EvilPunishFactor);

        emit LogDoubleSignPunishValidator(_val, block.timestamp);
    }

    function isDoubleSignPunished(bytes32 punishHash) external view returns (bool) {
        return doubleSignPunished[punishHash];
    }

    function doSlash(address _val, uint _factor) private {
        IValidator val = valMaps[_val];
        uint settledRewards = calcValidatorRewards(_val);
        // the slash amount will calculate from unWithdrawn stakes,
        // and then slash immediately, and first try subtracting the slash amount from staking record.
        // If there's no enough stake, it means some of the slash amount will come from the pending unbound staking.
        ValidatorInfo storage vInfo = valInfos[_val];
        uint slashAmount = (vInfo.unWithdrawn * _factor) / PunishBase;
        uint amountFromCurrStakes = slashAmount;
        if (vInfo.stake < slashAmount) {
            amountFromCurrStakes = vInfo.stake;
        }
        vInfo.stake -= amountFromCurrStakes;
        vInfo.debt = vInfo.stake * accRewardsPerStake;
        vInfo.incomeFees = 0;
        totalStake -= amountFromCurrStakes;
        vInfo.unWithdrawn -= slashAmount;
        emit TotalStakeChanged(_val, totalStake + amountFromCurrStakes, totalStake);

        val.punish{value: settledRewards}(_factor);
        // remove from ranking immediately
        topValidators.removeRanking(val);
    }

    // ** END of functions that will be called by the chain-code **

    // *** Functions of staking and delegating ***

    // @dev register a new validator by user ( on permission-less stage) or by admin (on permission stage)
    function registerValidator(
        address _val,
        address _manager,
        uint _rate,
        bool _acceptDelegation
    ) external payable onlyNotExists(_val) {
        if (msg.value > 0) {
            mustConvertStake(msg.value);
        }
        uint stake = msg.value;
        if (isOpened) {
            // need minimal self stakes on permission-less stage
            require(stake >= MinSelfStakes, "E20");
        } else {
            // admin only on permission stage
            require(msg.sender == admin, "E21");
        }
        // Default state is Idle, when the stakes >= ThresholdStakes, then the validator will be Ready immediately.
        State vState = State.Idle;
        if (stake >= ThresholdStakes) {
            vState = State.Ready;
        }
        // Create a validator with given info, and updates allValAddrs, valMaps, totalStake
        IValidator val = new Validator(_val, _manager, _rate, stake, _acceptDelegation, vState);
        allValidatorAddrs.push(_val);
        valMaps[_val] = val;
        //update rewards record
        updateRewardsRecord();
        uint debt = accRewardsPerStake * stake;
        valInfos[_val] = ValidatorInfo(stake, debt, 0, stake);

        totalStake += stake;
        // If the validator is Ready, add it to the topValidators and sort, and then emit ValidatorStateChanged event
        if (vState == State.Ready) {
            topValidators.improveRanking(val);
        }
        emit ValidatorRegistered(_val, _manager, _rate, stake, vState);

        emit TotalStakeChanged(_val, totalStake - stake, totalStake);
    }

    // @dev addStake is used for a validator to add it's self stake
    // @notice The founder locking rule is handled here, and some other rules are handled by the Validator contract.
    function addStake(address _val) external payable onlyExistsAndByManager(_val) {
        // founder locking
        require(founders[_val].locking == false || isReleaseLockEnd(), "E22");
        addStakeOrDelegation(_val, _val, true);
    }

    function addDelegation(address _val) external payable onlyExists(_val) {
        addStakeOrDelegation(_val, msg.sender, false);
    }

    function addStakeOrDelegation(address _val, address _stakeOwner, bool byValidator) private {
        mustConvertStake(msg.value);

        uint settledRewards = calcValidatorRewards(_val);

        IValidator val = valMaps[_val];
        RankingOp op = RankingOp.Noop;
        uint stake = msg.value;
        if (byValidator) {
            op = val.addStake{value: settledRewards}(stake);
        } else {
            op = val.addDelegation{value: settledRewards}(stake, _stakeOwner);
        }
        // update rewards info
        ValidatorInfo storage vInfo = valInfos[_val];
        // First, add stake
        vInfo.stake += stake;
        vInfo.unWithdrawn += stake;
        //Second, reset debt
        vInfo.debt = accRewardsPerStake * vInfo.stake;
        vInfo.incomeFees = 0;

        totalStake += stake;

        updateRanking(val, op);

        emit TotalStakeChanged(_val, totalStake - stake, totalStake);
    }

    // @dev subStake is used for a validator to subtract it's self stake.
    // @param _amount, the subtraction amount in unit of wei.
    // @notice The founder locking rule is handled here, and some other rules are handled by the Validator contract.
    function subStake(address _val, uint256 _amount) external onlyExistsAndByManager(_val) {
        FounderLock memory fl = founders[_val];
        bool ok = noFounderLocking(_val, fl, _amount);
        require(ok, "E22");

        subStakeOrDelegation(_val, _amount, true);
    }

    function subDelegation(address _val, uint256 _amount) external onlyExists(_val) {
        subStakeOrDelegation(_val, _amount, false);
    }

    function subStakeOrDelegation(address _val, uint256 _amount, bool byValidator) private {
        // the input _amount should not be zero
        require(_amount > 0, "E23");
        ValidatorInfo memory vInfo = valInfos[_val];
        // no enough stake to subtract
        require(vInfo.stake >= _amount, "E24");

        uint settledRewards = calcValidatorRewards(_val);

        IValidator val = valMaps[_val];
        RankingOp op = RankingOp.Noop;
        address stakeOwner = msg.sender;
        if (byValidator) {
            op = val.subStake{value: settledRewards}(_amount);
            stakeOwner = _val;
        } else {
            op = val.subDelegation{value: settledRewards}(_amount, payable(msg.sender));
        }
        afterLessStake(_val, val, _amount, op);
    }

    function exitStaking(address _val) external onlyExistsAndByManager(_val) {
        require(founders[_val].locking == false || isReleaseLockEnd(), "E22");

        doExit(_val, true);
    }

    function exitDelegation(address _val) external onlyExists(_val) {
        doExit(_val, false);
    }

    function doExit(address _val, bool byValidator) private {
        uint settledRewards = calcValidatorRewards(_val);
        IValidator val = valMaps[_val];
        RankingOp op = RankingOp.Noop;
        uint stake = 0;
        address stakeOwner = msg.sender;
        if (byValidator) {
            (op, stake) = val.exitStaking{value: settledRewards}();
            stakeOwner = _val;
        } else {
            (op, stake) = val.exitDelegation{value: settledRewards}(msg.sender);
        }
        afterLessStake(_val, val, stake, op);
    }
    // @dev validatorClaimAny claims any token that can be send to the manager of the specific validator.
    function validatorClaimAny(address _val) external onlyExistsAndByManager(_val) nonReentrant {
        doClaimAny(_val, true);
    }

    function delegatorClaimAny(address _val) external onlyExists(_val) nonReentrant {
        doClaimAny(_val, false);
    }

    function doClaimAny(address _val, bool byValidator) private {
        // settle rewards of the validator
        uint settledRewards = calcValidatorRewards(_val);
        //reset debt
        ValidatorInfo storage vInfo = valInfos[_val];
        vInfo.debt = accRewardsPerStake * vInfo.stake;
        vInfo.incomeFees = 0;

        // call IValidator function
        IValidator val = valMaps[_val];
        // the stakeEth had been deducted from totalStake at the time doing subtract or exit staking,
        // so we don't need to update the totalStake in here, just send it back to the owner.
        uint stake = 0;
        address payable recipient = payable(msg.sender);
        if (byValidator) {
            stake = val.validatorClaimAny{value: settledRewards}(recipient);
        } else {
            uint forceUnbound = 0;
            (stake, forceUnbound) = val.delegatorClaimAny{value: settledRewards}(recipient);
            if (forceUnbound > 0) {
                totalStake -= forceUnbound;
            }
        }
        if (stake > 0) {
            valInfos[_val].unWithdrawn -= stake;
            sendValue(recipient, stake);
            emit StakeWithdrawn(_val, msg.sender, stake);
        } else {
            emit ClaimWithoutUnboundStake(_val);
        }
    }

    // @dev mustConvertStake convert a value in wei to ether, and if the value is not an integer multiples of ether, it revert.
    function mustConvertStake(uint256 _value) private pure returns (uint256) {
        uint eth = _value / 1 ether;
        // staking amount must >= 1 StakeUnit
        require(eth >= StakeUnit, "E25");
        // the value must be an integer multiples of ether
        require((eth * 1 ether) == _value, "E26");
        return eth;
    }

    // @dev updateRewardsRecord updates the accRewardsPerStake += (rewardsPerBlock * deltaBlock)/totalStake
    // and set the lastUpdateAccBlock to current block number.
    function updateRewardsRecord() private {
        uint deltaBlock = block.number - lastUpdateAccBlock;
        if (deltaBlock > 0) {
            accRewardsPerStake += (rewardsPerBlock * COEFFICIENT * deltaBlock) / totalStake;
            lastUpdateAccBlock = block.number;
        }
    }

    // @dev calcValidatorRewards first updateRewardsRecord, and then calculates the validator's settled rewards
    // @return rewards need to settle, in wei
    function calcValidatorRewards(address _val) private returns (uint256) {
        updateRewardsRecord();
        ValidatorInfo memory vInfo = valInfos[_val];
        // settle rewards of the validator
        uint settledRewards = (accRewardsPerStake * vInfo.stake - vInfo.debt) / COEFFICIENT;
        settledRewards = checkStakingRewards(settledRewards);
        return settledRewards + vInfo.incomeFees;
    }

    function checkStakingRewards(uint _targetExpenditure) private returns (uint) {
        if (totalStakingRewards == 0) {
            return 0;
        }
        uint actual = _targetExpenditure;
        if (totalStakingRewards <= _targetExpenditure) {
            actual = totalStakingRewards;
            totalStakingRewards = 0;
            emit StakingRewardsEmpty(true);
        } else {
            totalStakingRewards -= _targetExpenditure;
        }
        return actual;
    }

    function afterLessStake(address _val, IValidator val, uint _amount, RankingOp op) private {
        ValidatorInfo storage vInfo = valInfos[_val];
        vInfo.stake -= _amount;
        vInfo.debt = accRewardsPerStake * vInfo.stake;
        vInfo.incomeFees = 0;

        totalStake -= _amount;
        updateRanking(val, op);

        emit TotalStakeChanged(_val, totalStake + _amount, totalStake);
    }

    function updateRanking(IValidator val, RankingOp op) private {
        if (op == RankingOp.Up) {
            topValidators.improveRanking(val);
        } else if (op == RankingOp.Down) {
            topValidators.lowerRanking(val);
        } else if (op == RankingOp.Remove) {
            topValidators.removeRanking(val);
        }
        return;
    }

    // @dev checkLocking checks if it's ok when a funding validator wants to subtracts some stakes.
    function noFounderLocking(address _val, FounderLock memory fl, uint _amount) private returns (bool) {
        if (fl.locking) {
            if (block.timestamp < basicLockEnd) {
                return false;
            } else {
                // check if the _amount is valid.
                uint targetUnbound = fl.unboundStake + _amount;
                if (targetUnbound > fl.initialStake) {
                    // _amount is too large.
                    return false;
                }
                if (releasePeriod > 0) {
                    uint _canReleaseCnt = (block.timestamp - basicLockEnd) / releasePeriod;
                    uint _canReleaseAmount = (fl.initialStake * _canReleaseCnt) / releaseCount;
                    //
                    if (_canReleaseCnt >= releaseCount) {
                        // all unlocked
                        fl.locking = false;
                        fl.unboundStake = targetUnbound;
                        founders[_val] = fl;
                        emit FounderUnlocked(_val);
                        // become no locking
                        return true;
                    } else {
                        if (targetUnbound <= _canReleaseAmount) {
                            fl.unboundStake = targetUnbound;
                            founders[_val] = fl;
                            // can subtract _amount;
                            return true;
                        }
                        // fl.unboundStake + _amount > _canReleaseAmount , return false
                        return false;
                    }
                } else {
                    // no release period, just unlock
                    fl.locking = false;
                    fl.unboundStake += _amount;
                    founders[_val] = fl;
                    emit FounderUnlocked(_val);
                    // become no locking
                    return true;
                }
            }
        }
        return true;
    }

    // ** functions for query ***

    // @dev anyClaimable returns how much token(rewards and unbound stakes) can be currently claimed
    // for the specific stakeOwner on a specific validator.
    // @param _stakeOwner, for delegator, this is the delegator address; for validator, this must be the manager(admin) address of the validator.
    function anyClaimable(address _val, address _stakeOwner) external view returns (uint) {
        return claimableHandler(_val, _stakeOwner, true);
    }

    // @dev claimableRewards returns how much rewards can be currently claimed
    // for the specific stakeOwner on a specific validator.
    // @param _stakeOwner, for delegator, this is the delegator address; for validator, this must be the manager(admin) address of the validator.
    function claimableRewards(address _val, address _stakeOwner) external view returns (uint) {
        return claimableHandler(_val, _stakeOwner, false);
    }

    function claimableHandler(address _val, address _stakeOwner, bool isIncludingStake) private view returns (uint) {
        if (valMaps[_val] == IValidator(address(0))) {
            return 0;
        }
        // calculates current expected accRewards
        uint deltaBlock = block.number - lastUpdateAccBlock;
        uint expectedAccRPS = accRewardsPerStake;
        if (deltaBlock > 0) {
            expectedAccRPS += (rewardsPerBlock * COEFFICIENT * deltaBlock) / totalStake;
        }
        ValidatorInfo memory vInfo = valInfos[_val];
        // settle rewards of the validator
        uint unsettledRewards = expectedAccRPS * vInfo.stake - vInfo.debt;
        unsettledRewards /= COEFFICIENT;
        if (unsettledRewards > totalStakingRewards) {
            unsettledRewards = totalStakingRewards;
        }
        unsettledRewards += vInfo.incomeFees;
        IValidator val = valMaps[_val];
        if (isIncludingStake) {
            return val.anyClaimable(unsettledRewards, _stakeOwner);
        } else {
            return val.claimableRewards(unsettledRewards, _stakeOwner);
        }
    }

    function getAllValidatorsLength() external view returns (uint) {
        return allValidatorAddrs.length;
    }

    function getPunishValidatorsLen() external view returns (uint256) {
        return lazyPunishedValidators.length;
    }

    function getPunishRecord(address _val) external view returns (uint256) {
        return lazyPunishRecords[_val].missedBlocksCounter;
    }

    function ethToWei(uint256 ethAmount) private pure returns (uint) {
        return ethAmount * 1 ether;
    }

    function isReleaseLockEnd() public view returns (bool) {
        return (block.timestamp >= basicLockEnd) && (block.timestamp - basicLockEnd) >= (releasePeriod * releaseCount);
    }

    // #if !Mainnet
    function simulateUpdateRewardsRecord() public view returns (uint256) {
        uint deltaBlock = block.number - lastUpdateAccBlock;
        if (deltaBlock > 0) {
            return accRewardsPerStake + (rewardsPerBlock * COEFFICIENT * deltaBlock) / totalStake;
        }
        return accRewardsPerStake;
    }

    function testMustConvertStake(uint256 _value) public pure returns (uint256) {
        return mustConvertStake(_value);
    }

    function testReduceBasicLockEnd(uint256 _value) public returns (uint256) {
        basicLockEnd = block.timestamp - _value;
        return basicLockEnd;
    }
    // #endif
}
