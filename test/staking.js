const hre = require("hardhat");
const { BigNumberish } = require("ethers");
const { expect } = require("chai");
const ethers = hre.ethers;
const utils = require("./utils");
const exp = require("constants");
const { toBN, isTopic } = require('web3-utils');
const { Signer } = require("ethers");

const State = {
    Idle: 0,
    Ready: 1,
    Jail: 2,
    Exit: 3
}

const params = {
    MaxValidators: 21,

    MaxStakes: 24000000,
    OverMaxStakes: 24000001,
    ThresholdStakes: 2_000_000,
    MinSelfStakes: 150_000,
    StakeUnit: 1,
    FounderLock: 3600,
    releasePeriod: 60,
    releaseCount: 100,

    totalRewards: utils.ethToWei("25000000"),
    rewardsPerBlock: utils.ethToWei("10"),
    epoch: 2,
    ruEpoch: 5,
    JailPeriod: 86400,

    singleValStake: utils.ethToWei("2000000"),
    singleValStakeEth: "2000000",

    LazyPunishThreshold: 3,
    DecreaseRate: 1,

    LazyPunishFactor: 1,
    EvilPunishFactor: 10,
    PunishBase: 1000,
}

describe("Staking test", function () {
    let signers
    let owner
    let factory
    let staking //  contract

    let commissionRate = 50;
    let currTotalStake = utils.ethToWei("0");


    let valFactory;
    const ZeroAddress = '0x0000000000000000000000000000000000000000';

    before(async function () {
        // runs once before the first test in this block
        signers = await hre.ethers.getSigners();
        owner = signers[0];
        vSigner = signers[1];
        fundation = signers[2];
        account4 = signers[3];
        account5 = signers[4];
        vaddr = vSigner.address;

        factory = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/Staking.sol:Staking");
        staking = await factory.deploy();
        // console.log(staking.target);
        expect(staking.target).to.be.properAddress
        valFactory = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/Validator.sol:Validator");
    });

    it('1. initialize', async () => {
        let balance = params.singleValStake * BigInt('24');
        balance = balance + params.totalRewards;
        // console.log(utils.weiToEth(balance))

        // address _admin,
        // uint256 _firstLockPeriod,
        // uint256 _releasePeriod,
        // uint256 _releaseCnt,
        // uint256 _totalRewards,
        // uint256 _rewardsPerBlock,
        // uint256 _epoch
        await staking.initialize(
            owner,
            params.FounderLock,
            params.releasePeriod,
            params.releaseCount,
            params.totalRewards,
            params.rewardsPerBlock,
            params.epoch,
            {
                value:balance
            }
        );

        expect(await staking.admin()).to.eq(owner.address);
        let timestamp = await utils.getLatestTimestamp();
        expect(await staking.basicLockEnd()).to.eq(parseInt(timestamp, 16) + params.FounderLock);
        expect(await staking.releasePeriod()).to.eq(params.releasePeriod);
        expect(await staking.releaseCount()).to.eq(params.releaseCount);
        expect(await staking.totalStakingRewards()).to.eq(params.totalRewards);
        expect(await staking.rewardsPerBlock()).to.eq(params.rewardsPerBlock);
        expect(await staking.blockEpoch()).to.eq(params.epoch);
        expect(await ethers.provider.getBalance(staking.target)).to.eq(balance);
    
    });

    it('2. initValidator', async () => {
        for (let i = 1; i < 25; i++) {
            let val = signers[i];
            let admin = signers[25 + i];
            let tx = await staking.initValidator(
                val.address, 
                admin.address, 
                50, 
                params.singleValStake,
                true);
            let receipt = await tx.wait();
            expect(receipt.status).equal(1);
        }
        expect(await staking.totalStake()).to.eq(params.singleValStake * BigInt(24));

        for (let i = 1; i < 4; i++) {
            let addr = await staking.allValidatorAddrs(i - 1);
            expect(signers[i].address).to.eq(addr);
            expect(await staking.valMaps(addr)).to.be.properAddress;
            let valContractAddr = await staking.valMaps(addr);
            let val = valFactory.attach(valContractAddr);
            expect(await val.totalStake()).to.eq(params.singleValStake);
            expect(await val.totalUnWithdrawn()).to.eq(params.singleValStake);
        }

        await expect(staking.initValidator(
            signers[1].address, 
            signers[1].address, 
            50, 
            params.singleValStake,
            true)).to.be.revertedWith("E07");
    });

    it('3. check removePermission', async () => {
        expect(await staking.isOpened()).to.eq(false);
        await expect(staking.removePermission()).to
            .emit(staking, "PermissionLess")
            .withArgs(true);
        expect(await staking.isOpened()).to.eq(true);
        await expect(staking.removePermission()).to.be.revertedWith("E16");
    });

    it('4. check getTopValidators', async () => {
        let topValidators = await staking.getTopValidators(0);
        expect(topValidators.length).to.eq(params.MaxValidators);
        topValidators = await staking.getTopValidators(10);
        expect(topValidators.length).to.eq(10);
        topValidators = await staking.getTopValidators(24);
        expect(topValidators.length).to.eq(24);
        topValidators = await staking.getTopValidators(100);
        expect(topValidators.length).to.eq(24);
    });

    it('5. check Validator contract', async () => {
        for (let i = 1; i < 25; i++) {
            let valAddress = signers[i];
            let adminAddress = signers[25 + i];
            let valContractAddr = await staking.valMaps(valAddress);
            let val = valFactory.attach(valContractAddr);
            expect(await val.owner()).to.eq(staking.target);
            expect(await val.validator()).to.eq(valAddress);
            expect(await val.manager()).to.eq(adminAddress);
            expect(await val.selfStake()).to.eq(params.singleValStake);
            expect(await val.totalStake()).to.eq(params.singleValStake);
            expect(await val.totalUnWithdrawn()).to.eq(params.singleValStake);
            expect(await val.state()).to.eq(State.Ready);
        }
    });

    it('6. check updateActiveValidatorSet', async () => {
        let activeValidators = await staking.getActiveValidators();
        expect(activeValidators.length).to.eq(0);

        let topValidators = await staking.getTopValidators(0);
        const len = topValidators.length;
        //console.log(topValidators);
        expect(len).to.be.eq(params.MaxValidators);

        while (true) {
            let number = await ethers.provider.getBlockNumber();
            if ((number + 1) % params.epoch !== 0) {
                await utils.mineEmptyBlock();
            } else {
                break;
            }
        }
        // const newset = [
        //     '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        //     '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        //     '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
        //     '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
        //     '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
        //     '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
        //     '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
        //     '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
        //     '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
        //     '0xBcd4042DE499D14e55001CcbB24a551F3b954096',
        //     '0x71bE63f3384f5fb98995898A86B02Fb2426c5788',
        //     '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a',
        //     '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec',
        //     '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097',
        //     '0xcd3B766CCDd6AE721141F452C550Ca635964ce71',
        //     '0x2546BcD3c84621e976D8185a91A922aE77ECEc30',
        //     '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E',
        //     '0xdD2FD4581271e230360230F9337D5c0430Bf44C0',
        //     '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199',
        //     '0x09DB0a93B389bEF724429898f539AEB7ac2Dd55f',
        //     '0x02484cb50AAC86Eae85610D6f4Bf026f30f6627D'
        //   ];

        let newset = Array.from(topValidators);
        await staking.updateActiveValidatorSet(newset);

        activeValidators = await staking.getActiveValidators();

        expect(activeValidators.length).to.eq(params.MaxValidators);
    });

    it('7. calc rewards', async () => {
        // update accRewardsPerStake by updateRewardsInfo
        while (true) {
            let number = await ethers.provider.getBlockNumber();
            if ((number + 1) % params.ruEpoch !== 0) {
                await utils.mineEmptyBlock();
            } else {
                break;
            }
        }
        // let tx = await staking.updateRewardsInfo(params.rewardsPerBlock);
        // let receipt = await tx.wait();
        // expect(receipt.status).to.eq(1);
        let number = await ethers.provider.getBlockNumber();
        // let stakeGwei = utils.ethToGwei(params.singleValStakeEth);
        // let totalStakeGwei = stakeGwei.mul(3);
        const totalStake = await staking.totalStake();
    
        let expectAccRPS = params.rewardsPerBlock * BigInt(number);
        var expectAccRPSGwei = utils.ethToWei(expectAccRPS.toString());
        expectAccRPS =  expectAccRPSGwei / BigInt(totalStake.toString());

        //console.log(expectAccRPS)
        // validator claimable
        let claimable = expectAccRPS * (params.singleValStake);
        const claimableReal = await staking.anyClaimable(signers[1].address,signers[1 + 25].address);
        expect(utils.ethToWei(claimableReal.toString())).to.eq(claimable);
        // console.log("blockNumber: ", await ethers.provider.getBlockNumber())

        // claim any
        // when sending a transaction, there will be a new block, so the rewards increase
        // Notice: how many times to calculate and when to calculate, should be exactly the same in the contract,
        // so to avoids the inaccurate integer calculation. For example: 300/3 == 100, but 100/3 + 100/3 + 100/3 == 99
        expectAccRPS = params.rewardsPerBlock * (BigInt( number + 1));
        expectAccRPSGwei = utils.ethToWei(expectAccRPS.toString());
        expectAccRPS =  expectAccRPSGwei/ BigInt(totalStake.toString());
        //console.log(expectAccRPS)
        let valContractAddr = await staking.valMaps(signers[1].address);
        let val = valFactory.attach(valContractAddr);

        let staking2 = staking.connect(signers[1 + 25]);
        claimable = expectAccRPS * (params.singleValStake)/ BigInt(1e18);
        tx = await staking2.validatorClaimAny(signers[1].address);
        //console.log("accRewardsPerStake ", await staking2.accRewardsPerStake());
        await expect(tx).to
            .emit(val, "RewardsWithdrawn")
            .withArgs(signers[1].address,signers[1 + 25].address, claimable);
        await expect(tx).to
            .emit(staking,"ClaimWithoutUnboundStake")
            .withArgs(signers[1].address)
    });

    it('8. check distributeBlockFee', async () => {
        let activeValidators = await staking.getActiveValidators();
        // console.log({ bakCnt: backupValidators.length });
        let cnt = activeValidators.length;
        let balances = [];
        for (let i = 0; i < cnt; i++) {
            // let val = await staking.valMaps(activeValidators[i]);
            let info = await staking.valInfos(activeValidators[i]);
            balances[i] = info[2];
        }

        let stake = utils.ethToWei("100");
        let blockFee = stake * BigInt(cnt);

        while (true) {
            let number = await ethers.provider.getBlockNumber();
            if ((number + 2) % params.epoch !== 0) {
                await utils.mineEmptyBlock();
            } else {
                break;
            }
        }

        await staking.distributeBlockFee({ value: blockFee });

        let feePerActiveValidator = blockFee / BigInt(cnt);

        for (let i = 0; i < activeValidators.length; i++) {
            
            let info = await staking.valInfos(activeValidators[i]);
            expect(info[2] - balances[i]).equal(feePerActiveValidator);
        }

    });

    it('9. check lazyPunish', async () => {
        let activeValidators = await staking.getActiveValidators();
        let cnt = activeValidators.length;

        for (let i = 0; i < cnt; i++) {
            let tx = await staking.lazyPunish(activeValidators[i]);
            let receipt = await tx.wait();
            expect(receipt.status).equal(1);
        }

        for (let i = 0; i < cnt; i++) {
            let lazyVal = await staking.lazyPunishedValidators(i);
            expect(await staking.getPunishRecord(activeValidators[i])).equal(1);
            expect(lazyVal).equal(activeValidators[i]);
        }
        let topVals = await staking.getTopValidators(100);
        let valContractAddr = await staking.valMaps(activeValidators[0]);
        let val = valFactory.attach(valContractAddr);
        let oldInfo = { stake: await val.totalStake(), unWithdrawn: await val.totalUnWithdrawn() };
        let oldtotalStake = await staking.totalStake();
        for (let i = 1; i < params.LazyPunishThreshold; i++) {
            let tx = await staking.lazyPunish(activeValidators[0]);
            let receipt = await tx.wait();
            expect(receipt.status).equal(1);
            if (i < params.LazyPunishThreshold - 1) {
                let missedBlocksCounter = await staking.getPunishRecord(activeValidators[0]);
                expect(missedBlocksCounter).equal(i + 1);
            } else { // doSlash
                // console.log("doSlash")
                // remove from ranking immediately
                expect(await staking.getPunishRecord(activeValidators[0])).equal(0);
                let newTopVals = await staking.getTopValidators(100);
                expect(newTopVals.length).equal(topVals.length - 1);
                for (let i = 0; i < newTopVals.length; i++) {
                    expect(activeValidators[0] !== newTopVals[i]).equal(true);
                }

                let slashAmount = oldInfo.unWithdrawn * BigInt(params.LazyPunishFactor) / BigInt(params.PunishBase);
                let amountFromCurrStakes = slashAmount;
                if (oldInfo.stake < slashAmount) {
                    amountFromCurrStakes = oldInfo.stake;
                }
                let newInfo = { stake: await val.totalStake(), unWithdrawn: await val.totalUnWithdrawn() };
                expect(newInfo.stake).to.eq(oldInfo.stake - BigInt(amountFromCurrStakes));
                expect(newInfo.unWithdrawn).to.eq(oldInfo.unWithdrawn - (slashAmount));
                expect(await staking.totalStake()).to.eq(oldtotalStake - (amountFromCurrStakes));
            }
        }
    });

    it('10. Multiple crimes during punishment', async () => {
        let oldtotalStake = await staking.totalStake();
        let activeValidators = await staking.getActiveValidators();
        let valAddr = activeValidators[1];
        let valContractAddr = await staking.valMaps(valAddr);
        let val = valFactory.attach(valContractAddr);
        let oldInfo = { stake: await val.totalStake(), unWithdrawn: await val.totalUnWithdrawn() };
        for (let i = 0; i < params.LazyPunishThreshold; i++) {
            let tx = await staking.lazyPunish(valAddr);
            let receipt = await tx.wait();
            expect(receipt.status).equal(1);
        }
        let slashAmount = oldInfo.unWithdrawn * BigInt(params.LazyPunishFactor) / BigInt(params.PunishBase);
        let amountFromCurrStakes = slashAmount;
        if (oldInfo.stake < slashAmount) {
            amountFromCurrStakes = oldInfo.stake;
        }
        let newInfo = { stake: await val.totalStake(), unWithdrawn: await val.totalUnWithdrawn() };
        expect(newInfo.stake).to.eq(oldInfo.stake - BigInt(amountFromCurrStakes));
        // let accRewardsPerStake = await staking.accRewardsPerStake();
        // expect(newInfo.debt).to.eq(accRewardsPerStake * newInfo.stake);
        expect(newInfo.unWithdrawn).to.eq(oldInfo.unWithdrawn - BigInt(slashAmount));
        expect(await staking.totalStake()).to.eq(oldtotalStake - BigInt(amountFromCurrStakes));
    });

    it('11. check registerValidator', async () => {
        let signer = signers[51];
        let admin = signers[52];
        let val = signer.address;
        let valAdmin = admin.address;

        let stakeWei = utils.ethToWei(params.MinSelfStakes.toString());
        let oldtotalStake = await staking.totalStake();
        let oldLength = await staking.getAllValidatorsLength();

        // address _val,
        // address _manager,
        // uint _rate,
        // uint _stakeAmount,
        // bool _acceptDelegation
        let tx = await staking.registerValidator(val, valAdmin, 50, true, {value: stakeWei});
        let receipt = await tx.wait();
        expect(receipt.status).equal(1);

        await expect(tx).to
            .emit(staking, "ValidatorRegistered")
            .withArgs(val, valAdmin, 50, utils.ethToWei(params.MinSelfStakes.toString()), State.Idle);
        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(val, oldtotalStake, oldtotalStake + utils.ethToWei(params.MinSelfStakes.toString()))

        let newLength = await staking.getAllValidatorsLength();
        expect(newLength).equal(oldLength + BigInt(1));

        let lastAddVal = await staking.allValidatorAddrs(newLength - BigInt(1));
        expect(lastAddVal).equal(val);

        await expect(staking)
    });

    it('12. check addStake', async () => {
        // E22、E25、E26、E29、 E35
        let signer = signers[1];
        let admin = signers[25 + 1];
        let val = signer.address;
        let valAdmin = admin.address;


        let stakeWei = utils.ethToWei(params.MinSelfStakes.toString());
        let diffWei = utils.ethToWei((params.ThresholdStakes - params.MinSelfStakes).toString());

        let stakingErrorAdmin = staking.connect(signers[2]);
        await expect(stakingErrorAdmin.addStake("0x0000000000000000000000000000000000000000", {value: stakeWei})).to.be.revertedWith("E08");
        await expect(stakingErrorAdmin.addStake(val, {value: stakeWei})).to.be.revertedWith("E02");

        let stakingLocked = staking.connect(admin);
        // locked
        await expect(stakingLocked.addStake(val, {value: stakeWei})).to.be.revertedWith("E22");
        await utils.increaseTime(60);
        await utils.mineEmptyBlock();
        // amount == 0.5 ether


        let signerUnlocked = signers[51];
        let adminUnlocked = signers[52];
        let stakingUnlocked = staking.connect(adminUnlocked);
        let oldtotalStake = await staking.totalStake();
        await expect(stakingUnlocked.addStake(signerUnlocked.address, {value: utils.ethToWei("0.5")})).to.be.revertedWith("E25");
        // amount == 1.5ether
        await expect(stakingUnlocked.addStake(signerUnlocked.address, {value: utils.ethToWei("1.5")})).to.be.revertedWith("E26");
        let valContractAddr = await staking.valMaps(signerUnlocked.address);
        let valContract = valFactory.attach(valContractAddr);
        let oldValTotalStake = await valContract.totalStake();

        await expect(stakingUnlocked.addStake(signerUnlocked.address, {value: utils.ethToWei(params.OverMaxStakes.toString())})).to.be.revertedWith("E29")
        let tx = await stakingUnlocked.addStake(signerUnlocked.address, {value: stakeWei / BigInt(2)});
        let receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signerUnlocked.address, oldtotalStake, oldtotalStake + stakeWei / BigInt(2))
        await expect(tx).to
            .emit(valContract, "StakesChanged")
            .withArgs(signerUnlocked.address, adminUnlocked.address, oldValTotalStake + stakeWei / BigInt(2))

        let delegator = signers[53];
        let stakingDelegator = staking.connect(delegator);
        // 0 address
        await expect(stakingErrorAdmin.addDelegation("0x0000000000000000000000000000000000000000", {value: stakeWei})).to.be.revertedWith("E08");


        tx = await stakingDelegator.addDelegation(signerUnlocked.address, {value: stakeWei / BigInt(2)});
        receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signerUnlocked.address, oldtotalStake + stakeWei / BigInt(2), oldtotalStake + stakeWei)

        await expect(tx).to
            .emit(valContract, "StakesChanged")
            .withArgs(signerUnlocked.address, delegator.address, oldValTotalStake + stakeWei)
    });

    it('13. check subStake', async () => {
        // locking == true
        let signer2 = signers[2];
        let admin2 = signers[27];
        // locking == false
        let signer50 = signers[51];
        let admin50 = signers[52];

        let deltaEth = 20000;

        // Do substake when the node is in the locking == true
        let stakingLocked = staking.connect(admin2);
        // address(0) 
        await expect(stakingLocked.subStake("0x0000000000000000000000000000000000000000", deltaEth)).to.be.revertedWith("E08");
        await expect(stakingLocked.subStake(signer50.address, deltaEth)).to.be.revertedWith("E02");
        await expect(stakingLocked.subStake(signer2.address, deltaEth)).to.be.revertedWith("E22");

        let valContractAddr = await staking.valMaps(signer2.address);
        let val = valFactory.attach(valContractAddr);
        // console.log("stake2", val.totalStake());

        // Calculate the upper limit of substake in advance
        // canRelease = 2000000 / 100
        let forceTimeDiff = params.releasePeriod;
        // let tx = await staking.testReduceBasicLockEnd(forceTimeDiff);
        // let receipt = await tx.wait();
        // expect(receipt.status).equal(1);

        let oldtotalStake = await staking.totalStake();
        expect(await val.state()).equal(2); //Jail
        await expect(stakingLocked.subStake(signer2.address, deltaEth + 1)).to.be.revertedWith("E22");
        let stakingUnLocked = staking.connect(admin50);

        await expect(stakingUnLocked.subStake(signer50.address, utils.ethToWei((deltaEth * 8).toString()))).to.be.revertedWith("E31");

        let signer20 = signers[20];
        let admin20 = signers[45];
        let stakingLocked20 = staking.connect(admin20);
        await utils.increaseTime(36000);
        await utils.mineEmptyBlock();
        let valContractAddr20 = await staking.valMaps(signer20.address);
        let val20 = valFactory.attach(valContractAddr20);
        expect(await val20.state()).equal(1);

        await stakingLocked20.addStake(signer20.address, {value: params.singleValStake});

        oldtotalStake = await staking.totalStake();
        // console.log("stake", val.totalStake());

        tx = await stakingLocked20.subStake(signer20.address, utils.ethToWei(deltaEth.toString()));


        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signer20.address, oldtotalStake, oldtotalStake - utils.ethToWei(deltaEth.toString()))

        tx = await stakingLocked20.subStake(signer20.address, utils.ethToWei(deltaEth.toString()));
        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signer20.address, oldtotalStake - utils.ethToWei(deltaEth.toString()), oldtotalStake - utils.ethToWei(deltaEth.toString()) * BigInt(2))


        // locking == false; Unlimited amount of subStake
        oldtotalStake = await staking.totalStake();
        // Do substake when the node is in the locking == false



    });

    it('14. check subDelegation', async () => {
        // It will not be restricted because of the locked state of the node
        let delegator = signers[53];
        let stakingDelegator = staking.connect(delegator);
        let signer20 = signers[20];
        let admin20 = signers[45];

        let signer15 = signers[15];
        let admin15 = signers[40];

        let diffWei = utils.ethToWei((params.MinSelfStakes).toString());
        let valContractAddr = await staking.valMaps(signer20.address);
        let valContract = valFactory.attach(valContractAddr);
        let oldtotalStake = await staking.totalStake();
        // console.log("oldtotalStake", oldtotalStake);
        let oldValTotalStake = await valContract.totalStake();
        // console.log("oldValTotalStake", oldValTotalStake);
        // console.log("state", await valContract.state());


        let valContractAddr15 = await staking.valMaps(signer15.address);
        let valContract15 = valFactory.attach(valContractAddr15);

        // console.log("state15", await valContract15.state());

        let tx = await stakingDelegator.addDelegation(signer20.address, {value: diffWei / BigInt(2)});
        let receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signer20.address, oldtotalStake, oldtotalStake + diffWei / BigInt(2))

        await expect(tx).to
            .emit(valContract, "StakesChanged")
            .withArgs(signer20.address, delegator.address, oldValTotalStake + diffWei / BigInt(2))

        await expect(stakingDelegator.subDelegation("0x0000000000000000000000000000000000000000", diffWei / BigInt(2))).to.be.revertedWith("E08");
        await expect(stakingDelegator.subDelegation(signer20.address, diffWei)).to.be.revertedWith("E24");
        await expect(stakingDelegator.subDelegation(signer20.address, 0)).to.be.revertedWith("E23");
        tx = await stakingDelegator.subDelegation(signer20.address, diffWei / BigInt(2));
        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signer20.address, oldtotalStake + diffWei / BigInt(2), oldtotalStake)
    });

    it('15. check exitStaking', async () => {
        // locking == true && Jail
        let signer2 = signers[2];
        let admin2 = signers[27];
        // locking == true
        let signer20 = signers[20];
        let admin20 = signers[45];

        let staking2 = staking.connect(admin2);

        let staking20 = staking.connect(admin20);

        // Forced arrival at the end of the lock period

        // Jail
        tx = await staking2.exitStaking(signer2.address);
        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        let diffWei = utils.ethToWei((params.MinSelfStakes).toString());

        valContractAddr = await staking.valMaps(signer2.address);
        valContract = valFactory.attach(valContractAddr);
        await expect(tx).to
            .emit(valContract, "StateChanged")
            .withArgs(signer2.address, admin2.address, State.Jail, State.Exit)

        // Initialize some data in advance to verify the delegatorClaimAny
        let delegator = signers[53];

        valContractAddr = await staking.valMaps(signer20.address);
        valContract = valFactory.attach(valContractAddr);
        let oldValTotalStake = await valContract.totalStake();

        let stakingDelegator = staking.connect(delegator);
        tx = await stakingDelegator.addDelegation(signer20.address, {value:diffWei / BigInt(2)});
        receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(valContract, "StakesChanged")
            .withArgs(signer20.address, delegator.address, oldValTotalStake + diffWei / BigInt(2))

        // Idle
        staking20 = staking.connect(admin20);
        tx = await staking20.exitStaking(signer20.address);
        receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(valContract, "StateChanged")
            .withArgs(signer20.address, admin20.address, State.Ready, State.Exit)

        await expect(staking20.addStake(signer20.address, {value:diffWei / BigInt(2)})).to.be.revertedWith("E28");
    });

    it('16. check exitDelegation', async () => {
        let diffWei = utils.ethToWei((params.ThresholdStakes - params.MinSelfStakes).toString());
        // Jail
        let signer2 = signers[2];
        let admin2 = signers[27];
        // Exit
        let signer20 = signers[20];
        let admin20 = signers[45];
        // Idle
        let signer50 = signers[51];
        let admin50 = signers[52];

        let delegator = signers[53];
        let stakingDelegator = staking.connect(delegator);

        // Add some data in advance
        await expect(stakingDelegator.addDelegation(signer2.address, {value: diffWei / BigInt(2)})).to.be.revertedWith("E28");
        await expect(stakingDelegator.addDelegation(signer20.address, {value: diffWei/ BigInt(2)})).to.be.revertedWith("E28");

        tx = await stakingDelegator.addDelegation(signer50.address, {value: diffWei / BigInt(2)});
        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        // Jail
        await expect(stakingDelegator.exitDelegation(signer2.address)).to.be.revertedWith("E28");
        // Exit
        await expect(stakingDelegator.exitDelegation(signer20.address)).to.be.revertedWith("E28");

        // Idle
        tx = await stakingDelegator.exitDelegation(signer50.address);
        receipt = await tx.wait();
        expect(receipt.status).equal(1);

        valContractAddr = await staking.valMaps(signer50.address);
        valContract = valFactory.attach(valContractAddr);
        const totals = await valContract.totalStake();
        await expect(tx).to
            .emit(valContract,"StakesChanged")
            .withArgs(signer50.address, delegator.address, totals)

        // locking == false
        let staking50 = staking.connect(admin50);
        tx = await staking50.exitStaking(signer50.address);
        receipt = await tx.wait();
        expect(receipt.status).equal(1);
        await expect(tx).to
            .emit(valContract,"StateChanged")
            .withArgs(signer50.address, admin50.address, State.Idle, State.Exit)
    });

    it('17. check reStaking', async () => {
        let diffWei = utils.ethToWei((params.MinSelfStakes).toString());
        // Ready
        let signer5 = signers[5];
        let admin5 = signers[30];


        // Ready
        let signer50 = signers[51];
        let admin50 = signers[52];

        let signer2 = signers[2];
        let admin2 = signers[27];
        // Exit
        let signer20 = signers[20];
        let admin20 = signers[45];



        valContractAddr = await staking.valMaps(signer5.address);
        valContract = valFactory.attach(valContractAddr);
        let oldValTotalStake = await valContract.totalStake();

        // console.log("oldValTotalStake5", oldValTotalStake);


        await staking.connect(admin5).addStake(signer5.address, {value: diffWei * BigInt(2)});

        let valTotalStake = await valContract.totalStake();

        // console.log("ValTotalStake5", valTotalStake);

        let oldtotalStake = await staking.totalStake();

        let blockFee = diffWei * BigInt(100);

        await staking.distributeBlockFee({ value: blockFee });

        // old val exit
        await expect(staking.connect(admin20).reStaking(signer20.address, signer50.address, diffWei)).to.be.revertedWith("E24");
        // new val exit

        await expect(staking.connect(admin5).reStaking(signer5.address, signer20.address, diffWei)).to.be.revertedWith("E28");

        await expect(staking.connect(admin2).reStaking(signer2.address, signer50.address, diffWei)).to.be.revertedWith("E35");

        let rewards = await staking.anyClaimable(signer5.address, admin5.address);

        // console.log(rewards);


        let tx = await staking.connect(admin5).reStaking(signer5.address, signers[16].address, diffWei);

        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signer5.address, oldtotalStake, oldtotalStake - diffWei);

        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signers[16].address, oldtotalStake - diffWei, oldtotalStake);

        await expect(tx).to
            .emit(staking, "ClaimWithoutUnboundStake")
            .withArgs(signer5.address);


    });

    it('18. check reDelegation', async () => {
        let diffWei = utils.ethToWei((params.MinSelfStakes).toString());
        // Ready
        let signer5 = signers[5];
        let admin5 = signers[30];


        // Ready
        let signer50 = signers[51];
        let admin50 = signers[52];

        let signer2 = signers[2];
        let admin2 = signers[27];
        // Exit
        let signer20 = signers[20];
        let admin20 = signers[45];



        valContractAddr = await staking.valMaps(signer5.address);
        valContract = valFactory.attach(valContractAddr);
        let oldValTotalStake = await valContract.totalStake();

        // console.log("oldValTotalStake5", oldValTotalStake);


        await staking.connect(admin5).addDelegation(signers[14].address, {value:diffWei * BigInt(2)});

        let valTotalStake = await valContract.totalStake();

        // console.log("ValTotalStake5", valTotalStake);

        let oldtotalStake = await staking.totalStake();

        let blockFee = diffWei * BigInt(100);

        await staking.distributeBlockFee({ value: blockFee });

        // old val exit
        await expect(staking.connect(admin20).reDelegation(signer20.address, signer50.address, diffWei)).to.be.revertedWith("E36");
        // new val exit

        await expect(staking.connect(admin5).reDelegation(signers[14].address, signer20.address, diffWei)).to.be.revertedWith("E28");

        await expect(staking.connect(admin2).reDelegation(signers[14].address, signer50.address, diffWei)).to.be.revertedWith("E36");

        let rewards = await staking.anyClaimable(signer5.address, admin5.address);

        // console.log(rewards);

        let tx = await staking.connect(admin5).reDelegation(signers[14].address, signers[16].address, diffWei);


        await expect(tx).to
            .emit(staking, "TotalStakeChanged")
            .withArgs(signers[14].address, oldtotalStake, oldtotalStake - diffWei);

        // await expect(tx).to
        // .emit(staking,"TotalStakeChanged")
        // .withArgs(signers[16].address, oldtotalStake - diffWei, oldtotalStake);

        await expect(tx).to
            .emit(staking, "ClaimWithoutUnboundStake")
            .withArgs(signers[14].address);
    });

    it('19. Bypass the stacking contract and call the verifier contract directly', async () => {
        let signer50 = signers[24];
        valContractAddr = await staking.valMaps(signer50.address);
        valContract = await valFactory.attach(valContractAddr);
        await expect(valContract.addStake(1000)).to.be.revertedWith("E01");
    });

    it('20. Admin checks',async () =>{
        let signer33 = signers[33];
        let signer22 = signers[22];
        await expect(staking.connect(signer33).changeAdmin(signer22.address)).to.be.rejectedWith("E02");
       
        const tx = await staking.changeAdmin(signer22.address);
        expect(tx).emit(staking,"AdminChanging").withArgs(signer22.address);
        const tx0 = await staking.connect(signer22).acceptAdmin();
        expect(tx0).emit(staking,"AdminChanged").withArgs(owner.address,signer22.address);
        const admin = await staking.admin();
        expect(admin).to.be.equal(signer22.address);
    });
})