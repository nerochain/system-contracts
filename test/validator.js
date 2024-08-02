const hre = require("hardhat");
const {BigNumber} = require("ethers");
const {expect} = require("chai");
const ethers = hre.ethers;
const utils = require("./utils");

const State = {
    Idle: 0,
    Ready: 1,
    Jail: 2,
    Exit: 3
}

const params = {
    MaxStakes: "24000000",
    OverMaxStakes: "24000001",
    ThresholdStakes: "2000000",
    MinSelfStakes: "150000",
    StakeUnit: 1,
    LazyPunishFactor: 1,
    EvilPunishFactor: "10",
    PunishBase: "1000",
    fees:"1000",
}

describe("Validator test", function () {
    let signers
    let owner
    let factory
    let vSigner; // validator
    let vaddr; // validator address
    let adminSigner; // admin signer
    let adminAddr; // admin address
    let validator // validator contract

    let commissionRate = 50;
    let currTotalStake;
    let initStake = utils.ethToWei(params.MinSelfStakes);
    let initAcceptDelegation = true;
    let initState = State.Idle;

    before(async function () {
        // runs once before the first test in this block
        signers = await hre.ethers.getSigners();
        owner = signers[0];
        vSigner = signers[1];
        vaddr = vSigner;
        adminSigner = signers[2];
        adminAddr = adminSigner;
        factory = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/Validator.sol:Validator");
        currTotalStake = initStake;
        validator = await factory.deploy(
            vaddr, 
            adminAddr, 
            commissionRate, 
            initStake, 
            initAcceptDelegation, 
            initState);
        
    });

    it('should check invalid parameter at deploy', async () => {
        await expect(factory.deploy(vaddr, vaddr, 101, initStake, true, State.Ready)).to.be.reverted;
        // console.log("1")
        let stake = utils.ethToWei(params.OverMaxStakes);
        // console.log("1")
        await expect(factory.deploy(vaddr, vaddr, commissionRate, stake, true, State.Ready)).to.be.reverted;
    });

    it('Initialization parameter check', async () => {
        expect(validator.target).to.be.properAddress;
        expect(await validator.owner()).eq(owner.address);
        expect(await validator.validator()).eq(vaddr);
        expect(await validator.admin()).eq(adminAddr);
        expect(await validator.commissionRate()).eq(commissionRate);
        expect(await validator.selfStake()).eq(initStake);
        expect(await validator.totalStake()).eq(initStake);
        expect(await validator.totalUnWithdrawn()).eq(initStake);
        expect(await validator.acceptDelegation()).eq(initAcceptDelegation);
        expect(await validator.state()).eq(initState);
    });

    it('1. the state should be ready when there is enough stakes, and the rewards and commission etc. are all correct', async () => {
        // send 2 * params.MinSelfStakes wei as rewards, then the accRewardsPerStake should be 1,
        // and selfDebt should be params.ThresholdStakes
        let delta = utils.ethToWei(params.ThresholdStakes)
        let sendRewards = utils.ethToWei((2 * params.MinSelfStakes).toString())
        let addStakeAmount = utils.ethToWei((39 * params.MinSelfStakes).toString())
        let oldTotalStake = await validator.totalStake()
        //let oldAccRewardsPerStake = await validator.accRewardsPerStake();

        await expect(validator.addStake(addStakeAmount)).to
            .emit(validator, "StateChanged")
            .withArgs(vaddr, adminAddr, State.Idle, State.Ready);

        currTotalStake = currTotalStake + addStakeAmount;
        expect(await validator.state()).eq(State.Ready);
        expect(await validator.totalStake()).eq(currTotalStake);
        expect(await validator.totalUnWithdrawn()).eq(currTotalStake);
        expect(await validator.selfStake()).eq(currTotalStake);
        expect(await validator.getSelfDebt()).eq(0);
        const  amount = await validator.anyClaimable(0,adminAddr);
        console.log(amount[0],amount[1]);

    });

    it('2. should correct for validatorClaimAny', async () => {
        totalStake = await validator.totalStake();
        // console.log(totalStake);
        
        // await validator.receiveFee({value:utils.ethToWei(params.fees)});

        const  amount = await validator.anyClaimable(utils.ethToWei(params.fees),adminAddr.address);
        // console.log(amount[0],amount[1]);

        expect(await validator.validatorClaimAny(adminAddr.address)).to
        .emit(validator, "RewardsWithdrawn")
        .withArgs(vaddr.address, adminAddr.address, amount[1]);
    });

    it('3. should add delegation and calc rewards correctly', async () => {
        let delta = utils.ethToWei((3 * params.MinSelfStakes).toString());
        let delegator = signers[3].address;
        totalStake = await validator.totalStake();
        // console.log(totalStake);
        await expect(validator.addDelegation(delta, delegator)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake + delta);
        // await validator.receiveFee({value:utils.ethToWei(params.fees)});
        const amount = utils.ethToWei(params.fees);
        totalStake1 = await validator.totalStake();
        // console.log(totalStake1);
        const  amount1 = await validator.anyClaimable(amount, adminAddr);
        // console.log(amount[0],amount[1]);
        const  amount2 = await validator.anyClaimable(amount, delegator);
        // console.log(amount1[0],amount1[1]);
        expect(amount1 + amount2).to.be.eq(utils.ethToWei(params.fees))
    });

    it('4. should correct for delegatorClaimAny', async () => {
        let delegatorRewards = utils.ethToWei(params.ThresholdStakes);
        let delegator = signers[3].address;
        // console.log(await validator.delegators(delegator));
        const amount = await validator.anyClaimable(delegatorRewards , delegator);
        await expect(validator.delegatorClaimAny(delegator, {value: delegatorRewards})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator, amount);
    });

})

describe("Validator independent test", function () {
    let signers
    let owner
    let factory
    let validator // contract
    let vSigner; // validator
    let vaddr; // validator address
    let delegator // address
    let adminSigner; // admin signer
    let adminAddr; // admin address

    let commissionRate = 50;
    let currTotalStake;
    let stake = utils.ethToWei("500000");
    let E18 = utils.ethToWei("1");

    beforeEach(async function () {
        // runs once before the first test in this block
        signers = await hre.ethers.getSigners();
        owner = signers[0];
        vSigner = signers[1];
        vaddr = vSigner.address;
        adminSigner = signers[2];
        adminAddr = adminSigner.address;
        delegator = signers[3].address;

        factory = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/Validator.sol:Validator", owner);
        validator = await factory.deploy(vaddr, adminAddr, commissionRate, stake, true, State.Idle);
        await validator.addDelegation(stake, delegator);
        currTotalStake = stake * BigInt(2);
    });


    it('1. subStake with correct rewards calculation', async () => {
        // subStake
        // current total stake: 1m , validator: 500k, delegator 500k
        // validator subtract 100k,
        // ==> 900k, 400k, 500k
        // currTotalStake = 1m
        // stake = 500k
        // ThresholdStakes
        // MinSelfStakes

        expect(await validator.totalStake()).eq(currTotalStake);
        // console.log(await validator.totalStake());

        let selfStakeWei = await validator.selfStake();
        // console.log(selfStakeWei);

        expect(selfStakeWei).eq(stake);
        let currTotalRewards = currTotalStake 
       

        const accRewardsPerStake = currTotalRewards / currTotalStake;
        // console.log(accRewardsPerStake);

        if (currTotalStake >= utils.ethToWei(params.ThresholdStakes) && selfStakeWei >= utils.ethToWei(params.MinSelfStakes)) {
            expect(await validator.state()).eq(State.Ready);
        } else {
            expect(await validator.state()).eq(State.Idle);
        }

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);

        let delta = utils.ethToWei("100000"); // 100000000000000 wei
        await expect(validator.subStake(delta,true)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, adminAddr, currTotalStake - delta);
        // and then settle rewards , set rewards to 2 * 900k

        //await validator.receiveFee({value:currTotalRewards});

        let currTotalRewards1 = currTotalStake - delta - delta;
        // validator commission: 50% ==> 900k
        // validator rewards 4/9 ==> 400k
        // delegator rewards 5/9 ==> 500k
        let valExpectRewards = currTotalRewards1 / BigInt(18) * BigInt(13); // 1300k

        let delegatorExpectRewards = currTotalRewards1 - valExpectRewards;
        delegatorExpectRewards = delegatorExpectRewards / BigInt(1000000) *  BigInt(1000000);
        // await validator.receiveFee({value:currTotalRewards1});

        let selfStake = await validator.selfStake();
        // console.log(selfStake);

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(delta);
        const account1 = await validator.anyClaimable(currTotalRewards1,delegator);
        expect(account1).eq(delegatorExpectRewards);

        const rewards = await validator.anyClaimable(currTotalRewards1,adminAddr);
        expect(rewards).eq(currTotalStake - delta - delegatorExpectRewards );

        await expect(validator.validatorClaimAny(adminAddr,{value: currTotalRewards1})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, adminAddr, rewards - delta);
        // the delegator has half currTotalRewards as staking rewards
        
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);

        await expect(validator.subStake(delta,false)).to
        .emit(validator, "StakesChanged")
        .withArgs(vaddr, adminAddr, currTotalStake - delta - delta);

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);
        
    });

    it('1.1 subStake use unbound with correct rewards calculation', async () => {
        // subStake
        // current total stake: 1m , validator: 500k, delegator 500k
        // validator subtract 100k,
        // ==> 900k, 400k, 500k
        // currTotalStake = 1m
        // stake = 500000
        // ThresholdStakes
        // MinSelfStakes

        expect(await validator.totalStake()).eq(currTotalStake);
        // console.log(await validator.totalStake());

        let selfStakeWei = await validator.selfStake();
        // console.log(selfStakeWei);

        expect(selfStakeWei).eq(stake);
        let currTotalRewards = currTotalStake 
       

        const accRewardsPerStake = currTotalRewards / currTotalStake;
        // console.log(accRewardsPerStake);

        if (currTotalStake >= utils.ethToWei(params.ThresholdStakes) && selfStakeWei >= utils.ethToWei(params.MinSelfStakes)) {
            expect(await validator.state()).eq(State.Ready);
        } else {
            expect(await validator.state()).eq(State.Idle);
        }

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);

        let delta = utils.ethToWei("100000"); // 100000000000000 wei
        await expect(validator.subStake(delta,false)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, adminAddr, currTotalStake - delta);

        let currTotalRewards1 = currTotalStake - delta - delta;

        let valExpectRewards = currTotalRewards1 / BigInt(18) * BigInt(13); // 1300k

        let delegatorExpectRewards = currTotalRewards1 - valExpectRewards;
        delegatorExpectRewards = delegatorExpectRewards / BigInt(1000000) *  BigInt(1000000);
        // await validator.receiveFee({value:currTotalRewards1});

        let selfStake = await validator.selfStake();
        // console.log(selfStake);

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);
        const account1 = await validator.anyClaimable(currTotalRewards1,delegator)
        expect(account1).eq(delegatorExpectRewards);

        const rewards = await validator.anyClaimable(currTotalRewards1,adminAddr);
        expect(rewards).eq(currTotalRewards1 - delegatorExpectRewards);

        await expect(validator.validatorClaimAny(adminAddr,{value:currTotalRewards1})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, adminAddr, rewards);
        // the delegator has half currTotalRewards as staking rewards
        
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);

        await expect(validator.subStake(delta,false)).to
        .emit(validator, "StakesChanged")
        .withArgs(vaddr, adminAddr, currTotalStake - delta - delta);

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);
        
    });

    it('2. subDelegation with correct rewards calculation', async () => {
        // subDelegation with rewards
        // current total stake: 1m , validator: 500k, delegator 500k
        // delegator subtract 500k,
        // ==> 500k, 500k, 0
        let delta = utils.ethToWei("500000");
        // currTotalRewards 2m
        let settledRewards = currTotalStake * BigInt(2);

        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        // await validator.receiveFee({value:settledRewards});

        await expect(validator.subDelegation(delta, delegator,true,{value:settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta);
            
        expect(await validator.testGetClaimableUnbound(delegator)).eq(delta);


        // currently ,the delegator should has 1/4 of settledRewards;
        // and it can't share the later rewards
        let delegatorExpectRewards = settledRewards / BigInt(4);

        const rewardsD = await validator.anyClaimable(settledRewards,delegator);

        expect(rewardsD).eq(delegatorExpectRewards);

        // await validator.receiveFee({value:settledRewards});

        const rewardsV = await validator.anyClaimable(settledRewards,adminAddr);

        expect(rewardsV).eq(settledRewards * BigInt(2) - delegatorExpectRewards);

        // double rewards ==> commission: 2m, validator: 500k + 1m = 1.5m , that is 7/8 of total rewards, delegator: 500k + 0 = 500k, 1/8 total rewards
        let validatorExpectRewards = settledRewards * BigInt(2*7) / BigInt(8)
        await expect(validator.validatorClaimAny(adminAddr,{value:settledRewards})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, adminAddr, validatorExpectRewards);

        const rewardsD1 = await validator.anyClaimable(settledRewards,delegator);
        expect(rewardsD1).eq(delegatorExpectRewards);

        await expect(validator.delegatorClaimAny(delegator)).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator, delegatorExpectRewards);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
    });

    it('2.1 subDelegation use unbound with correct rewards calculation', async () => {
        // subDelegation with rewards
        // current total stake: 1m , validator: 500k, delegator 500k
        // delegator subtract 500k,
        // ==> 500k, 500k, 0
        let delta = utils.ethToWei("500000");
        // currTotalRewards 2m
        let settledRewards = currTotalStake * BigInt(2);

        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        // await validator.receiveFee({value:settledRewards});

        const newDlg0 = await validator.delegators(delegator);
 
        const totalS = await validator.totalStake();
    

        await expect(validator.subDelegation(delta, delegator, false,{value:settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta);
            
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
       const newDlg = await validator.delegators(delegator);
        
    

        // currently ,the delegator should has 1/4 of settledRewards;
        // and it can't share the later rewards
        let delegatorExpectRewards = settledRewards / BigInt(4);

        const rewardsD = await validator.anyClaimable(settledRewards,delegator);

        expect(rewardsD).eq(0);

        // await validator.receiveFee({value:settledRewards});

        const rewardsV = await validator.anyClaimable(settledRewards,adminAddr);

        expect(rewardsV).eq(settledRewards * BigInt(2) - delegatorExpectRewards);

        // double rewards ==> commission: 2m, validator: 500k + 1m = 1.5m , that is 7/8 of total rewards, delegator: 500k + 0 = 500k, 1/8 total rewards
        let validatorExpectRewards = settledRewards * BigInt(2*7) / BigInt(8)
        await expect(validator.validatorClaimAny(adminAddr,{value:settledRewards})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, adminAddr, validatorExpectRewards);

        const rewardsD1 = await validator.anyClaimable(settledRewards,delegator);
        expect(rewardsD1).eq(0);
        await expect(validator.delegatorClaimAny(delegator)).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator, delegatorExpectRewards);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
    });

    it('3. exitStaking with correct rewards calculation', async () => {
        let oldTotalStake = await validator.totalStake();
        let oldSelfStake = await validator.selfStake();
        let sendRewards = currTotalStake * BigInt(2);

        let oldAccRewardsPerStake = await validator.accRewardsPerStake();
        let receivedRewards = TestHandleReceivedRewards(sendRewards, oldAccRewardsPerStake, commissionRate, oldTotalStake)
        let accRewardsPerStake = receivedRewards.accRewardsPerStake;
        let currCommission = receivedRewards.currCommission;

        expect(await validator.state()).eq(State.Idle);
        await expect(validator.exitStaking({value: sendRewards})).to
            .emit(validator, "StateChanged")
            .withArgs(vaddr, adminAddr, State.Idle, State.Exit);
        expect(await validator.state()).eq(State.Exit);
        expect(await validator.totalStake()).eq(oldTotalStake -oldSelfStake);
        expect(await validator.accRewardsPerStake()).eq(accRewardsPerStake);
        expect(await validator.currCommission()).eq(currCommission);
        expect(await validator.selfStake()).eq(0);

        let dlg = await validator.delegators(delegator);
        let oldStake = dlg.stake;
        await expect(validator.delegatorClaimAny(delegator, {value: 0})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator, oldStake);
        dlg = await validator.delegators(delegator);
        expect(dlg.stake).eq(0);
    });

    it('4. exitDelegation with correct rewards calculation', async () => {
        let oldTotalStake = await validator.totalStake();
        let sendRewards = currTotalStake *BigInt(2);
        let oldAccRewardsPerStake = await validator.accRewardsPerStake();
        let receivedRewards = TestHandleReceivedRewards(sendRewards, oldAccRewardsPerStake, commissionRate, oldTotalStake)
        let accRewardsPerStake = receivedRewards.accRewardsPerStake;
        let currCommission = receivedRewards.currCommission;

        let dlg = await validator.delegators(delegator);
        let oldStake = dlg.stake;

        let oldPendingUnbound = await validator.testGetClaimableUnbound(delegator);
        expect(oldPendingUnbound).eq(0);

        await expect(validator.exitDelegation(delegator, {value: sendRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, oldTotalStake - oldStake);
        expect(await validator.accRewardsPerStake()).eq(accRewardsPerStake);
        expect(await validator.currCommission()).eq(currCommission);
        expect(await validator.totalStake()).eq(oldTotalStake - oldStake);

        let newDlg = await validator.delegators(delegator);
        expect(newDlg.settled).eq(oldStake * accRewardsPerStake);
        expect(newDlg.stake).eq(0);

        //console.log(await validator.getPendingUnboundRecord(delegator, 0));
        let newPendingUnbound = await validator.testGetClaimableUnbound(delegator);
        expect(newPendingUnbound).eq(oldStake);

        dlg = await validator.delegators(delegator);
        let claimable = accRewardsPerStake * dlg.stake + dlg.settled - dlg.debt;
        await expect(validator.delegatorClaimAny(delegator, {value: 0})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator, claimable / utils.ethToWei(params.StakeUnit.toString()));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
    });

    it('5. Substake executes multiple times in a row', async () => {
        expect(await validator.totalStake()).eq(currTotalStake);
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);

        let delta = utils.ethToGwei("100000"); // 100000000000000 wei
        await expect(validator.subStake(delta,true)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, adminAddr, currTotalStake - delta);

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(delta);
        
        await expect(validator.subStake(delta,true)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, adminAddr, currTotalStake - delta * BigInt(2));

        expect(await validator.testGetClaimableUnbound(vaddr)).eq(delta * BigInt(2));
        
        await expect(validator.subStake(delta,true)).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, adminAddr, currTotalStake - delta * BigInt(3));
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(delta * BigInt(3));

        // and then settle rewards , set rewards to 2 * 900k
        let currTotalRewards = currTotalStake - delta * BigInt(2);
        // validator commission: 50% ==> 900k
        // validator rewards 4/9 ==> 400k
        // delegator rewards 5/9 ==> 500k
        let valExpectRewards = currTotalRewards / BigInt(14) * BigInt(9);
        let delegatorExpectRewards = currTotalRewards - valExpectRewards;

        delegatorExpectRewards = delegatorExpectRewards / BigInt(1000000) *  BigInt(1000000);
        valExpectRewards = currTotalRewards - delegatorExpectRewards;
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(delta * BigInt(3));
        expect(await validator.anyClaimable(currTotalRewards, adminAddr)).eq(valExpectRewards + delta * BigInt(3));
        await expect(validator.validatorClaimAny(adminAddr, {value: currTotalRewards})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, adminAddr, valExpectRewards);
        // the delegator has half currTotalRewards as staking rewards
        expect(await validator.anyClaimable(0, delegator)).eq(delegatorExpectRewards);
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(0);
    });

    it('6. SubDelegation executes multiple times in a row', async () => {
        let delta = utils.ethToWei("50000");
        // currTotalRewards 2m
        let settledRewards = currTotalStake * BigInt(2);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        await expect(validator.subDelegation(delta, delegator,false, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        await expect(validator.subDelegation(delta, delegator,false, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta * BigInt(2));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        await expect(validator.subDelegation(delta, delegator, false, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta * BigInt(3));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        let accRewardsPerStake = await validator.accRewardsPerStake();
        let dlg = await validator.delegators(delegator);
        let claimable = accRewardsPerStake * dlg.stake + dlg.settled - dlg.debt;
        await expect(validator.delegatorClaimAny(delegator, {value: 0})).to
            .emit(validator, "RewardsWithdrawn")
            .withArgs(vaddr, delegator,  claimable / utils.ethToWei(params.StakeUnit.toString()));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
    });
})

describe("Validator pushing test", function () {
    let signers
    let owner
    let factory
    let validator // contract
    let vSigner; // validator
    let vaddr; // validator address
    let delegator // address
    let adminSigner; // admin signer
    let adminAddr; // admin address

    let commissionRate = 50;
    let currTotalStake;
    let stake = utils.ethToWei("500000");

    beforeEach(async function () {
        // runs once before the first test in this block
        signers = await hre.ethers.getSigners();
        owner = signers[0];
        vSigner = signers[1];
        vaddr = vSigner.address;
        adminSigner = signers[2];
        adminAddr = adminSigner.address;
        delegator = signers[3].address;

        factory = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/Validator.sol:Validator", owner);
        validator = await factory.deploy(vaddr, adminAddr, commissionRate, stake, true, State.Idle);
        await validator.addDelegation(stake, delegator);
        currTotalStake = stake* BigInt(2);
    });

    it('1. punish with correct rewards calculation', async () => {
        let oldTotalStake = await validator.totalStake();
        let sendRewards = currTotalStake* BigInt(2);
        let oldAccRewardsPerStake = await validator.accRewardsPerStake();
        let receivedRewards = TestHandleReceivedRewards(sendRewards, oldAccRewardsPerStake, commissionRate, oldTotalStake)
        let accRewardsPerStake = receivedRewards.accRewardsPerStake;
        let currCommission = receivedRewards.currCommission;
        let oldTotalUnWithdrawn = await validator.totalUnWithdrawn();
        let oldSelfstake = await validator.selfStake();
        let oldPendingUnbound = await validator.testGetClaimableUnbound(vaddr);
        let oldSelfUnWithdrawn = oldSelfstake + oldPendingUnbound;
        let oldAccPunishFactor = await validator.accPunishFactor();
        //console.log(await utils.getLatestCoinbase());
        await expect(validator.punish(params.EvilPunishFactor, {value: sendRewards})).to
            .emit(validator, "StateChanged")
            .withArgs(vaddr, "0xC014BA5EC014ba5ec014Ba5EC014ba5Ec014bA5E", State.Idle, State.Jail);

        let slashAmount = oldTotalUnWithdrawn * BigInt(params.EvilPunishFactor) /BigInt(params.PunishBase);
        let newTotalUnWithdrawn = await validator.totalUnWithdrawn();
        expect(newTotalUnWithdrawn).eq(oldTotalUnWithdrawn - slashAmount);

        let selfSlashAmount = oldSelfUnWithdrawn * BigInt(params.EvilPunishFactor) / BigInt(params.PunishBase);
        let newSelfstake = 0;
        let newPendingUnbound = 0;
        if (oldSelfstake >= selfSlashAmount) {
            newSelfstake = oldSelfstake - selfSlashAmount;
        } else {
            let debt = selfSlashAmount - oldSelfstake;
            if (newPendingUnbound >= debt) {
                newPendingUnbound = oldPendingUnbound - debt;
            } else {
                newPendingUnbound = 0;
            }
            newSelfstake = 0;
        }
        expect(await validator.testGetClaimableUnbound(vaddr)).eq(newPendingUnbound);
        expect(await validator.selfStake()).eq(newSelfstake);
        expect(await validator.accPunishFactor()).eq(oldAccPunishFactor + BigInt(params.EvilPunishFactor));
        expect(await validator.accRewardsPerStake()).eq(accRewardsPerStake);
        expect(await validator.currCommission()).eq(currCommission);
    });

    it('2. calcDelegatorPunishment with correct rewards calculation', async () => {
        let accPunishFactor = await validator.accPunishFactor();
        let dlg = await validator.delegators(delegator);
        expect(dlg.punishFree).eq(0);
        let oldPendingUnbound = await validator.testGetClaimableUnbound(vaddr)
        let deltaFactor = accPunishFactor - dlg.punishFree;
        let totalDelegation = dlg.stake + oldPendingUnbound ;
        let amount = totalDelegation * deltaFactor / BigInt(params.PunishBase);
        expect(await validator.testCalcDelegatorPunishment(delegator)).eq(amount);
    });

    it('3. Create test data for addunboundrecord in advance', async () => {
        let delta = utils.ethToGwei("50000");
        // currTotalRewards 2m
        let settledRewards = currTotalStake* BigInt(2);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);

        await expect(validator.subDelegation(delta, delegator, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(delta);

        await expect(validator.subDelegation(delta, delegator, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta * BigInt(2));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(delta* BigInt(2));

        await expect(validator.subDelegation(delta, delegator, {value: settledRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, currTotalStake - delta * BigInt(3));
        expect(await validator.testGetClaimableUnbound(delegator)).eq(delta * BigInt(3));

        let dlg = await validator.delegators(delegator);
        let oldStake = dlg.stake;
        let oldTotalStake = await validator.totalStake();
        let sendRewards = currTotalStake * BigInt(2);

        await expect(validator.exitDelegation(delegator, {value: sendRewards})).to
            .emit(validator, "StakesChanged")
            .withArgs(vaddr, delegator, oldTotalStake - oldStake);

        expect(await validator.testGetClaimableUnbound(delegator)).eq(oldStake + delta * BigInt(3));
    });

    it('4. test slashFromUnbound whether there is data overflow', async () => {
        let amountUnbound = await validator.testGetClaimableUnbound(delegator);
        let amountUnboundDiv5 = amountUnbound / BigInt(5);
        for (let i = 1; i <= 5; i ++) {
            await validator.testSlashFromUnbound(delegator, amountUnboundDiv5);
            expect(await validator.testGetClaimableUnbound(delegator)).eq(amountUnbound - amountUnboundDiv5 * BigInt(i));
        }
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
        await validator.testSlashFromUnbound(delegator, amountUnboundDiv5);
        expect(await validator.testGetClaimableUnbound(delegator)).eq(0);
        // Old data is deleted correctly
        let newUnbound =  await validator.unboundRecords(delegator);
        expect(newUnbound.count).eq(0);
        expect(newUnbound.startIdx).eq(0);
        expect(newUnbound.pendingAmount).eq(0);
    });
})

function TestHandleReceivedRewards(sendRewards, oldAccRewardsPerStake, commissionRate, oldTotalStake) {
    sendRewards = utils.ethToWei(sendRewards.toString())
    let c = sendRewards * BigInt(commissionRate) / BigInt(100);
    let newRewards = sendRewards - c;
    let rps = newRewards / oldTotalStake;
    let currCommission = sendRewards- (rps * oldTotalStake);
    let accRewardsPerStake = oldAccRewardsPerStake + rps 
    return {accRewardsPerStake, currCommission};
}