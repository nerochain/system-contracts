// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const {expect, use} = require("chai");
const exp = require("constants");
const {ethers,BigNumber} = require("ethers");
const hre = require("hardhat");
//const ethers = hre.ethers;
const utils = require("./utils");

describe("GenesisLock contract test", function () {


    let owner;
    let account1;
    let account2;
    let account3;
    let account4;
    let account5;
    let lock;
    let mockAccount;

    let periodTime = 50;
    let lockTime = 50;
    let maxLockTime = 31622400;
    let lockedAmount0 = utils.ethToWei("1000");
    let lockedAmount1 = utils.ethToWei("100");
    let LockingContract;
    let lockingContract;
    let snapshotId;
    const ZeroAddress = '0x0000000000000000000000000000000000000000';
    beforeEach(async  () => {

        [owner, account1, account2, account3, account4, account5] = await hre.ethers.getSigners();


        LockingContract = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/GenesisLock.sol:GenesisLock");
        MockAccount = await hre.ethers.getContractFactory("cache/solpp-generated-contracts/mock/MockAccount.sol:MockAccount")
        const nonce = await owner.getNonce();
        console.log("nonce:",nonce);
        const from = owner.address.toString();
        contractAddress = ethers.getCreateAddress({from,nonce});
        lock = await LockingContract.deploy();
        mockAccount = await MockAccount.deploy(lock.target);
        // snapshotId = await utils.takeSnapshot();
        // console.log(snapshotId);
    });
    // afterEach(async () =>{
    //     await utils.revertSnapshot(snapshotId);
    //     snapshotId = await utils.takeSnapshot();
    // })

    describe("initialize:", async () => {
        it('should contract initialize success', async function () {
            await lock.initialize(periodTime);
            const period = await lock.periodTime();
            expect(period.toString()).to.be.equal(periodTime.toString());
        });
        it('should contract initialize fail when re-initialize ', async function () {
            await lock.initialize(periodTime);
            const period = await lock.periodTime();
            expect(period.toString()).to.be.equal(periodTime.toString());
            await expect(lock.initialize(periodTime)).to.be.revertedWith("already initialized");
        });
        it('should contract initialize fail when periodTime is 0', async function () {
            await expect(lock.initialize(0)).to.be.revertedWith("invalid periodTime");  
        });
    })


    describe("init:", async () => {
        it('init success', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );
            const lastTime = await utils.getLatestTimestamp();
            const startTime = await lock.startTime();
            expect(lastTime).to.be.equal(startTime);
            const userinfo1 = await lock.getUserInfo(account1.address);
            const userinfo2 = await lock.getUserInfo(account2.address);
            expect(userinfo1[2]).to.be.equal(userinfo2[2]);
            expect(userinfo1[1]).to.be.equal(lockedAmount0);
            expect(userinfo2[1]).to.be.equal(lockedAmount1);
        })
        it('init fail for not initialize',async () => {
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            )).to.be.revertedWith("not initialized");
        })

        it('init fail for not match userAddress.length and typeId.length',async () => {
            await lock.initialize(periodTime);
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            )).to.be.revertedWith("typeId length must equal userAddress");
        })
        it('init fail for not match userAddress.length and lockedAmount.length',async () => {
            await lock.initialize(periodTime);
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            )).to.be.revertedWith("lockedAmount length must equal userAddress");
        })
        it('init fail for not match userAddress.length and lockedTime.length', async() => {
            await lock.initialize(periodTime);
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime
                ],[
                    5,6
                ]
            )).to.be.revertedWith("lockedTime length must equal userAddress");
        })
        it('init fail for not match userAddress.length and periodAmount.length',async () => {
            await lock.initialize(periodTime);
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5
                ]
            )).to.be.revertedWith("periodAmount length must equal userAddress");
        })
        it('init fail with zero address',async () => {
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );
            await expect(lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            )).to.be.revertedWith("user address already exists");
        })

    })
    describe("appendLockRecord:", async () => {
        it('success', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await lock.appendLockRecord(account3.address,3,lockTime,4,{value: lockedAmount0});
            const userinfo1 = await lock.getUserInfo(account1.address);
            const userinfo2 = await lock.getUserInfo(account2.address);
            const userinfo3 = await lock.getUserInfo(account3.address);
            expect(userinfo1[2]).to.be.equal(userinfo2[2]);
            expect(userinfo1[1]).to.be.equal(lockedAmount0);
            expect(userinfo2[1]).to.be.equal(lockedAmount1);
            expect(userinfo3[2]).to.be.equal(userinfo2[2]);
            expect(userinfo3[1]).to.be.equal(lockedAmount0);
        })
        it('fail for too trivial value', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(account3.address,3,lockTime,4,{value: lockedAmount1})).to.be.revertedWith("too trivial");
        })
        it('fail for zero user address', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(ZeroAddress,3,lockTime,4,{value: lockedAmount0})).to.be.revertedWith("zero address");
        })
        it('fail for error user type', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(account3.address,0,lockTime,4,{value: lockedAmount0})).to.be.revertedWith("need a type id for human read");
        })
        it('fail for long lock time', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(account3.address,3,maxLockTime + 1 ,4,{value: lockedAmount0})).to.be.revertedWith("firstLockTime violating WhitePaper rules");
        })

        it('fail for erroe lock period', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(account3.address,3,lockTime ,0,{value: lockedAmount0})).to.be.revertedWith("lockPeriodCnt violating WhitePaper rules");
            await expect(lock.appendLockRecord(account3.address,3,lockTime ,49,{value: lockedAmount0})).to.be.revertedWith("lockPeriodCnt violating WhitePaper rules");
        })
        it('fail for lock-up user', async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );

            await expect(lock.appendLockRecord(account1.address,3,lockTime ,4,{value: lockedAmount0})).to.be.revertedWith("user address already have lock-up");
        })
    })

    describe("claim:", async () => {
        it("success", async () => {
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
   
            await utils.increaseTime(100);
            await utils.mineEmptyBlock();
            const txInfo = {
                to: lock.target,
                value: lockedAmount0
            };
            const resp = await owner.sendTransaction(txInfo);
            await resp.wait();
            const cmp = await lock.getClaimablePeriod(account1.address);
            expect(cmp).to.be.equal(BigInt(1))
            const res = await lock.getClaimableAmount(account1.address);
            expect(res[0]).to.be.equal(lockedAmount0/(BigInt(5)));
            expect(res[1]).to.be.equal(BigInt(1));
            const tx = await lock.connect(account1).claim();
            await expect(tx).to
            .emit(lock, "ReleaseClaimed")
            .withArgs(account1.address,res[1], res[0])
        })
        it("Have no token released", async () => {
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await expect(lock.connect(account1).claim()).to.be.revertedWith("Have no token released");
        })
        it("native token transfer failed!", async () => {
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
   
            await utils.increaseTime(100);
            await utils.mineEmptyBlock();
            const cmp = await lock.getClaimablePeriod(account1.address);
            expect(cmp).to.be.equal(BigInt(1))
            const res = await lock.getClaimableAmount(account1.address);
            expect(res[0]).to.be.equal(lockedAmount0/(BigInt(5)));
            expect(res[1]).to.be.equal(BigInt(1));
            await expect(lock.connect(account1).claim()).to.be.revertedWith("transfer failed!");
        })
        it('failt for changing all right', async () =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await lock.connect(account1).changeAllRights(account2);
            await expect(lock.connect(account1).claim()).to.be.revertedWith("All right on changing");
        })
    })
    describe("changeAllRights:", async () => {
        it('success', async () =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await lock.connect(account1).changeAllRights(account2);
            const to = await lock.rightsChanging(account1.address);
            expect(to).to.be.equal(account2.address);
            // const userinfo1 = await lock.getUserInfo(account1.address);
            // const userinfo2 = await lock.getUserInfo(account2.address);
            // expect(userinfo1[0]).to.be.equal(0);
            // expect(userinfo1[1]).to.be.equal(0);
            // expect(userinfo1[2]).to.be.equal(0);
            // expect(userinfo1[3]).to.be.equal(0);
            // expect(userinfo1[4]).to.be.equal(0);
            // expect(userinfo1[5]).to.be.equal(0);
            // expect(userinfo2[0]).to.be.equal(BigInt(1));
            // expect(userinfo2[1]).to.be.equal(lockedAmount0);
            // expect(userinfo2[2]).to.be.equal(lockTime);
            // expect(userinfo2[3].toString()).to.be.equal("5");
            // expect(userinfo2[4]).to.be.equal(0);
            // expect(userinfo2[5]).to.be.equal(0);
        })
        it('fail for unlock from account', async () =>{
            await lock.initialize(periodTime);
            // await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await expect(lock.connect(account1).changeAllRights(account2)).to.be.revertedWith("sender have no lock-up");
        })
        it('fail for lock-up to account', async () =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await expect(lock.connect(account1).changeAllRights(account1)).to.be.revertedWith("_to address already have lock-up");
        })

        it('fail for claimed from account', async () =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await utils.increaseTime(300);
            await utils.mineEmptyBlock();
            const txInfo = {
                to: lock.target,
                value: lockedAmount0
            };
            const resp = await owner.sendTransaction(txInfo);
            await resp.wait();
            await lock.connect(account1).claim();
            await expect(lock.connect(account1).changeAllRights(account2)).to.be.revertedWith("all claimed, no need to do anything");
        })
        it('fail for to account is ZeroAddress', async () =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await expect(lock.connect(account1).changeAllRights(ZeroAddress)).to.be.revertedWith("invalid address");
        })
    })
    describe("acceptAllRights:", async () => {
        it('success', async() =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await lock.connect(account1).changeAllRights(account2);
            const to = await lock.rightsChanging(account1.address);
            expect(to).to.be.equal(account2.address);
            await lock.connect(account2).acceptAllRights(account1.address);
            const userinfo1 = await lock.getUserInfo(account1.address);
            const userinfo2 = await lock.getUserInfo(account2.address);
            expect(userinfo1[0]).to.be.equal(0);
            expect(userinfo1[1]).to.be.equal(0);
            expect(userinfo1[2]).to.be.equal(0);
            expect(userinfo1[3]).to.be.equal(0);
            expect(userinfo1[4]).to.be.equal(0);
            expect(userinfo1[5]).to.be.equal(0);
            expect(userinfo2[0]).to.be.equal(BigInt(1));
            expect(userinfo2[1]).to.be.equal(lockedAmount0);
            expect(userinfo2[2]).to.be.equal(lockTime);
            expect(userinfo2[3].toString()).to.be.equal("5");
            expect(userinfo2[4]).to.be.equal(0);
            expect(userinfo2[5]).to.be.equal(0);
            const to1 = await lock.rightsChanging(account1.address);
            expect(to1).to.be.equal(ZeroAddress);
        })

        it('fail for no changing record', async() =>{
            await lock.initialize(periodTime);
            await lock.init([account1.address],[1],[lockedAmount0],[lockTime],[5]);
            await lock.connect(account1).changeAllRights(account3.address);
            const to = await lock.rightsChanging(account1.address);
            expect(to).to.be.equal(account3.address);
            await expect(lock.connect(account2).acceptAllRights(account1.address)).to.be.revertedWith("no changing record");
         
        })

        it('fail for lock-up account', async() =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );
            await lock.connect(account1).changeAllRights(account3.address);
            const to = await lock.rightsChanging(account1.address);
            expect(to).to.be.equal(account3.address);
            await lock.appendLockRecord(account3.address,3,lockTime,4,{value: lockedAmount0});
            await expect(lock.connect(account3).acceptAllRights(account1.address)).to.be.revertedWith("sender already have lock-up");
         
        })
        it("data test",async () =>{
            await lock.initialize(periodTime);
            await lock.init(
                [
                    account1.address,
                    account2.address
                ],[
                    1,2
                ],[
                    lockedAmount0,
                    lockedAmount1
                ],[
                    lockTime,
                    lockTime
                ],[
                    5,6
                ]
            );
            await lock.connect(account1).changeAllRights(account3.address);
            const to = await lock.rightsChanging(account1.address);
            expect(to).to.be.equal(account3.address);

            await utils.increaseTime(300);
            await utils.mineEmptyBlock();
            const txInfo = {
                to: lock.target,
                value: lockedAmount0
            };
            const resp = await owner.sendTransaction(txInfo);
            await resp.wait();
            await lock.connect(account3).acceptAllRights(account1.address);
            const res = await lock.getClaimableAmount(account3.address);
            expect(res[0]).to.be.equal(lockedAmount0);
            expect(res[1]).to.be.equal(BigInt(5));
            const tx = await lock.connect(account3).claim();
            await expect(tx).to
            .emit(lock, "ReleaseClaimed")
            .withArgs(account3.address,res[1], res[0])

        })
    })
})

