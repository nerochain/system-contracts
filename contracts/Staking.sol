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
        uint stakeGWei; // in gwei
        uint debt; // debt for the calculation of staking rewards, wei
        uint unWithdrawn; // total un-withdrawn stakes in gwei, in case the validator need to be punished, the punish amount will calculate according to this.
    }

    struct FounderLock {
        uint initialStakeGWei; // total initial stakes, gwei
        uint unboundStakeGWei; // total unbound stakes, gwei
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

    uint256 public constant ValidatorFeePercent = 80; // 80%

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
    uint256 public totalStakeGWei; // Total stakes, gwei.
    uint256 public currRewardsPerBlock; // wei
    uint256 public accRewardsPerStake; // accumulative rewards per stakeGWei
    uint256 public lastUpdateAccBlock; // block number of last updates to the accRewardsPerStake
    uint256 public totalStakingRewards; // amount of totalStakingRewards, not including bonus.

    // necessary restriction for the miner to update some consensus relative value
    uint public rewardsUpdateEpoch; // set on initialize, update the currRewardsPerBlock once per rewardsUpdateEpoch (considering 3 sec per block)
    uint public blockEpoch; //set on initialize,
    mapping(uint256 => mapping(Operation => bool)) operationsDone;

    mapping(uint => bool) public currRewardsPerBlockUpdated; // block.number => bool
    mapping(uint => bool) public feeDistributed;
    mapping(uint => bool) public validatorsUpdated;

    address payable public communityPool;

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
        uint256 stakeGWei,
        State st
    );
    event TotalStakeGWeiChanged(address indexed changer, uint oldStake, uint newStake);
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
        uint256 _epoch,
        uint256 _ruEpoch,
        address payable _communityPool
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
        require(_epoch > 0 && _ruEpoch > 0, "E12");
        //        require(_rewardsPerBlock > 0, ""); // don't need to restrict
        admin = _admin;
        basicLockEnd = block.timestamp + _firstLockPeriod;
        releasePeriod = _releasePeriod;
        releaseCount = _releaseCnt;
        totalStakingRewards = _totalRewards;
        currRewardsPerBlock = _rewardsPerBlock;
        blockEpoch = _epoch;
        rewardsUpdateEpoch = _ruEpoch;

        communityPool = _communityPool;
    }

    // @param _stakes, the staking amount in ether.
    function initValidator(
        address _val,
        address _manager,
        uint _rate,
        uint _stakeEth,
        bool _acceptDelegation
    ) external onlyInitialized onlyNotExists(_val) {
        // only on genesis block for the chain initialize code to execute
        // #if Mainnet
        require(block.number == 0, "E13");
        // #endif
        // invalid stake
        require(_stakeEth > 0, "E14");
        uint stakeGwei = ethToGwei(_stakeEth);
        uint tempTotalStakeGWei = totalStakeGWei + stakeGwei;
        uint recordBalance = gweiToWei(tempTotalStakeGWei) + totalStakingRewards;
        // invalid initial params
        require(address(this).balance >= recordBalance, "E15");
        // create a funder validator with state of Ready
        IValidator val = new Validator(_val, _manager, _rate, stakeGwei, _acceptDelegation, State.Ready);
        allValidatorAddrs.push(_val);
        valMaps[_val] = val;
        valInfos[_val] = ValidatorInfo(stakeGwei, 0, stakeGwei);
        founders[_val] = FounderLock(stakeGwei, 0, true);

        totalStakeGWei += stakeGwei;

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

    // updateRewardsInfo updates currRewardsPerBlock once per RewardsUpdateEpoch
    function updateRewardsInfo(
        uint256 _rewardsPerBlock
    )
        external
        // #if Mainnet
        onlyEngine
        // #endif
        onlyOperateOnce(Operation.UpdateRewardsPerBlock)
    {
        // only RewardsUpdateEpoch block
        require(block.number % rewardsUpdateEpoch == 0, "E19");
        if (currRewardsPerBlock != _rewardsPerBlock) {
            updateRewardsRecord();
            currRewardsPerBlock = _rewardsPerBlock;
        }
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
            uint feePerValidator = (msg.value * ValidatorFeePercent) / 100 / cnt;
            uint cpFee = msg.value - (feePerValidator * cnt);
            for (uint i = 0; i < cnt; i++) {
                IValidator val = valMaps[activeValidators[i]];
                val.receiveFee{value: feePerValidator}();
            }
            sendValue(communityPool, cpFee);
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

    function isDoubleSignPunished(bytes32 punishHash) public view returns (bool) {
        return doubleSignPunished[punishHash];
    }

    function doSlash(address _val, uint _factor) private {
        IValidator val = valMaps[_val];
        uint settledRewards = calcValidatorRewards(_val);
        // the slash amount will calculate from unWithdrawn stakes,
        // and then slash immediately, and first try subtracting the slash amount from staking record.
        // If there's no enough stakeGWei, it means some of the slash amount will come from the pending unbound staking.
        ValidatorInfo storage vInfo = valInfos[_val];
        uint slashAmount = (vInfo.unWithdrawn * _factor) / PunishBase;
        uint amountFromCurrStakes = slashAmount;
        if (vInfo.stakeGWei < slashAmount) {
            amountFromCurrStakes = vInfo.stakeGWei;
        }
        vInfo.stakeGWei -= amountFromCurrStakes;
        vInfo.debt = vInfo.stakeGWei * accRewardsPerStake;
        totalStakeGWei -= amountFromCurrStakes;
        vInfo.unWithdrawn -= slashAmount;
        emit TotalStakeGWeiChanged(_val, totalStakeGWei + amountFromCurrStakes, totalStakeGWei);

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
        uint stakeEth = 0;
        if (msg.value > 0) {
            stakeEth = mustConvertStake(msg.value);
        }
        uint stakeGWei = ethToGwei(stakeEth);
        if (isOpened) {
            // need minimal self stakes on permission-less stage
            require(stakeGWei >= MinSelfStakes, "E20");
        } else {
            // admin only on permission stage
            require(msg.sender == admin, "E21");
        }
        // Default state is Idle, when the stakes >= ThresholdStakes, then the validator will be Ready immediately.
        State vState = State.Idle;
        if (stakeGWei >= ThresholdStakes) {
            vState = State.Ready;
        }
        // Create a validator with given info, and updates allValAddrs, valMaps, totalStake
        IValidator val = new Validator(_val, _manager, _rate, stakeGWei, _acceptDelegation, vState);
        allValidatorAddrs.push(_val);
        valMaps[_val] = val;
        //update rewards record
        updateRewardsRecord();
        uint debt = accRewardsPerStake * stakeGWei;
        valInfos[_val] = ValidatorInfo(stakeGWei, debt, stakeGWei);

        totalStakeGWei += stakeGWei;
        // If the validator is Ready, add it to the topValidators and sort, and then emit ValidatorStateChanged event
        if (vState == State.Ready) {
            topValidators.improveRanking(val);
        }
        emit ValidatorRegistered(_val, _manager, _rate, stakeGWei, vState);

        emit TotalStakeGWeiChanged(_val, totalStakeGWei - stakeGWei, totalStakeGWei);
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
        uint deltaEth = mustConvertStake(msg.value);

        uint settledRewards = calcValidatorRewards(_val);

        IValidator val = valMaps[_val];
        RankingOp op = RankingOp.Noop;
        uint stakeGWei = ethToGwei(deltaEth);
        if (byValidator) {
            op = val.addStake{value: settledRewards}(stakeGWei);
        } else {
            op = val.addDelegation{value: settledRewards}(stakeGWei, _stakeOwner);
        }
        // update rewards info
        ValidatorInfo storage vInfo = valInfos[_val];
        // First, add stake
        vInfo.stakeGWei += stakeGWei;
        vInfo.unWithdrawn += stakeGWei;
        //Second, reset debt
        vInfo.debt = accRewardsPerStake * vInfo.stakeGWei;

        totalStakeGWei += stakeGWei;

        updateRanking(val, op);

        emit TotalStakeGWeiChanged(_val, totalStakeGWei - stakeGWei, totalStakeGWei);
    }

    // @dev subStake is used for a validator to subtract it's self stake.
    // @param _deltaEth, the subtraction amount in unit of ether.
    // @notice The founder locking rule is handled here, and some other rules are handled by the Validator contract.
    function subStake(address _val, uint256 _deltaEth) external onlyExistsAndByManager(_val) {
        FounderLock memory fl = founders[_val];
        uint stakeGWei = ethToGwei(_deltaEth);
        bool ok = noFounderLocking(_val, fl, stakeGWei);
        require(ok, "E22");

        subStakeOrDelegation(_val, stakeGWei, true);
    }

    function subDelegation(address _val, uint256 _deltaEth) external onlyExists(_val) {
        subStakeOrDelegation(_val, ethToGwei(_deltaEth), false);
    }

    function subStakeOrDelegation(address _val, uint256 _deltaGWei, bool byValidator) private {
        // the input _deltaGWei should not be zero
        require(_deltaGWei > 0, "E23");
        ValidatorInfo memory vInfo = valInfos[_val];
        // no enough stake to subtract
        require(vInfo.stakeGWei >= _deltaGWei, "E24");

        uint settledRewards = calcValidatorRewards(_val);

        IValidator val = valMaps[_val];
        RankingOp op = RankingOp.Noop;
        address stakeOwner = msg.sender;
        if (byValidator) {
            op = val.subStake{value: settledRewards}(_deltaGWei);
            stakeOwner = _val;
        } else {
            op = val.subDelegation{value: settledRewards}(_deltaGWei, payable(msg.sender));
        }
        afterLessStake(_val, val, _deltaGWei, op);
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
        uint stakeGWei = 0;
        address stakeOwner = msg.sender;
        if (byValidator) {
            (op, stakeGWei) = val.exitStaking{value: settledRewards}();
            stakeOwner = _val;
        } else {
            (op, stakeGWei) = val.exitDelegation{value: settledRewards}(msg.sender);
        }
        afterLessStake(_val, val, stakeGWei, op);
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
        vInfo.debt = accRewardsPerStake * vInfo.stakeGWei;

        // call IValidator function
        IValidator val = valMaps[_val];
        // the stakeEth had been deducted from totalStake at the time doing subtract or exit staking,
        // so we don't need to update the totalStake in here, just send it back to the owner.
        uint stakeGwei = 0;
        address payable recipient = payable(msg.sender);
        if (byValidator) {
            stakeGwei = val.validatorClaimAny{value: settledRewards}(recipient);
        } else {
            uint forceUnbound = 0;
            (stakeGwei, forceUnbound) = val.delegatorClaimAny{value: settledRewards}(recipient);
            if (forceUnbound > 0) {
                totalStakeGWei -= forceUnbound;
            }
        }
        if (stakeGwei > 0) {
            valInfos[_val].unWithdrawn -= stakeGwei;
            uint stake = gweiToWei(stakeGwei);
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

    // @dev updateRewardsRecord updates the accRewardsPerStake += (currRewardsPerBlock * deltaBlock)/totalStake
    // and set the lastUpdateAccBlock to current block number.
    function updateRewardsRecord() private {
        uint deltaBlock = block.number - lastUpdateAccBlock;
        if (deltaBlock > 0) {
            accRewardsPerStake += (currRewardsPerBlock * deltaBlock) / totalStakeGWei;
            lastUpdateAccBlock = block.number;
        }
    }

    // @dev calcValidatorRewards first updateRewardsRecord, and then calculates the validator's settled rewards
    // @return rewards need to settle
    function calcValidatorRewards(address _val) private returns (uint256) {
        updateRewardsRecord();
        ValidatorInfo memory vInfo = valInfos[_val];
        // settle rewards of the validator
        uint settledRewards = accRewardsPerStake * vInfo.stakeGWei - vInfo.debt;
        settledRewards = checkStakingRewards(settledRewards);
        return settledRewards;
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

    function afterLessStake(address _val, IValidator val, uint _deltaGWei, RankingOp op) private {
        ValidatorInfo storage vInfo = valInfos[_val];
        vInfo.stakeGWei -= _deltaGWei;
        vInfo.debt = accRewardsPerStake * vInfo.stakeGWei;

        totalStakeGWei -= _deltaGWei;
        updateRanking(val, op);

        emit TotalStakeGWeiChanged(_val, totalStakeGWei + _deltaGWei, totalStakeGWei);
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
    function noFounderLocking(address _val, FounderLock memory fl, uint _deltaGWei) private returns (bool) {
        if (fl.locking) {
            if (block.timestamp < basicLockEnd) {
                return false;
            } else {
                // check if the _deltaGWei is valid.
                uint targetUnbound = fl.unboundStakeGWei + _deltaGWei;
                if (targetUnbound > fl.initialStakeGWei) {
                    // _deltaGWei is too large.
                    return false;
                }
                if (releasePeriod > 0) {
                    uint _canReleaseCnt = (block.timestamp - basicLockEnd) / releasePeriod;
                    uint _canReleaseAmount = (fl.initialStakeGWei * _canReleaseCnt) / releaseCount;
                    //
                    if (_canReleaseCnt >= releaseCount) {
                        // all unlocked
                        fl.locking = false;
                        fl.unboundStakeGWei = targetUnbound;
                        founders[_val] = fl;
                        emit FounderUnlocked(_val);
                        // become no locking
                        return true;
                    } else {
                        if (targetUnbound <= _canReleaseAmount) {
                            fl.unboundStakeGWei = targetUnbound;
                            founders[_val] = fl;
                            // can subtract _deltaGWei;
                            return true;
                        }
                        // fl.unboundStakeGWei + _deltaGWei > _canReleaseAmount , return false
                        return false;
                    }
                } else {
                    // no release period, just unlock
                    fl.locking = false;
                    fl.unboundStakeGWei += _deltaGWei;
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
    function anyClaimable(address _val, address _stakeOwner) public view returns (uint) {
        return claimableHandler(_val, _stakeOwner, true);
    }

    // @dev claimableRewards returns how much rewards can be currently claimed
    // for the specific stakeOwner on a specific validator.
    // @param _stakeOwner, for delegator, this is the delegator address; for validator, this must be the manager(admin) address of the validator.
    function claimableRewards(address _val, address _stakeOwner) public view returns (uint) {
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
            expectedAccRPS += (currRewardsPerBlock * deltaBlock) / totalStakeGWei;
        }
        ValidatorInfo memory vInfo = valInfos[_val];
        // settle rewards of the validator
        uint unsettledRewards = expectedAccRPS * vInfo.stakeGWei - vInfo.debt;
        if (unsettledRewards > totalStakingRewards) {
            unsettledRewards = totalStakingRewards;
        }
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

    function getPunishValidatorsLen() public view returns (uint256) {
        return lazyPunishedValidators.length;
    }

    function getPunishRecord(address _val) public view returns (uint256) {
        return lazyPunishRecords[_val].missedBlocksCounter;
    }

    function ethToGwei(uint256 ethAmount) private pure returns (uint) {
        return ethAmount * 1 gwei;
    }

    function gweiToWei(uint256 gweiAmount) private pure returns (uint) {
        return gweiAmount * 1 gwei;
    }

    function isReleaseLockEnd() public view returns (bool) {
        return (block.timestamp >= basicLockEnd) && (block.timestamp - basicLockEnd) >= (releasePeriod * releaseCount);
    }

    // #if !Mainnet
    function simulateUpdateRewardsRecord() public view returns (uint256) {
        uint deltaBlock = block.number - lastUpdateAccBlock;
        if (deltaBlock > 0) {
            return accRewardsPerStake + (currRewardsPerBlock * deltaBlock) / totalStakeGWei;
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
