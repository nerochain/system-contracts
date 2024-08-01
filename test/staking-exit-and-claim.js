// Authorized by zero@fairyproof

const { expect, assert } = require("chai");
const { ethers } = require("hardhat");
const utils = require("./utils");

const State = {
    Idle: 0,
    Ready: 1,
    Jail: 2,
    Exit: 3
}

function convertNum(num) {
    let big = ethers.BigNumberish("" + num)
    let str = big.toHexString()
    let index = 0
    for(let i=2;i<str.length;i++) {
        if(str[i] !== "0") {
            index = i;
            break;
        }
    }
    if(index === 0) {
        return str;
    }else {
        return str.substring(0,2) + str.substring(index)
    }
}

const params = {
    MaxStakes: 24000000,
    OverMaxStakes: 24000001,
    ThresholdStakes: 50000,
    MinSelfStakes: 50000,
    StakeUnit: 1,
    FounderLock: 3600,
    releasePeriod: 60,
    releaseCount: 24,

    totalRewards: utils.ethToWei("25000000"),
    rewardsPerBlock: utils.ethToWei("10"),
    epoch: 200,
    ruEpoch: 5,

    singleValStake: utils.ethToWei("500000"),
    singleValStakeEth: "500000",
}

describe("Staking Test", function () {
    let instance;
    let owner,user1,user2,user3,users;
    let valFactory;
    let bonus;
    let communityPool;
    let account5;
 

    beforeEach( async function() {
        let Staking = await ethers.getContractFactory("Staking");
        instance = await Staking.deploy();
        [owner,user1,user2,user3, ...users] = await ethers.getSigners();
        valFactory = await ethers.getContractFactory("cache/solpp-generated-contracts/Validator.sol:Validator");
        // address _admin,
        // address _btrAddress,
        // uint256 _epoch,
        // address payable _foundationPool
        // console.log("Staking: ",instance.target);
        BTR = await hre.ethers.getContractFactory("BTR");
        btr = await BTR.deploy(
            [user3.address],
            [ethers.parseUnits("1000000000",18)]
        );
        // console.log("BTR: ",btr.target);

        let args = [
            owner.address,
            btr.target,
            params.epoch,
            user3.address
        ]
        let balance = params.singleValStake * BigInt(3);
        balance = balance + params.totalRewards ;
        await instance.initialize(...args);

    })


    describe("claim test", () => {
        // let val;
        let value = utils.ethToWei(params.singleValStakeEth);

        // address _val,
        // address _manager,
        // uint _rate,
        // bool _acceptDelegation
        beforeEach(async () => {
            for(let i=0;i<3;i++) {
                let _val = users[i].address;
                await instance.initValidator(_val, user1.address, 10, true);
            }
        });
        

        it("validatorClaimAny only manager", async () => {
            // get validator contract
            let valContractAddr = await instance.valMaps(users[0].address);
            let validator = valFactory.attach(valContractAddr);
            // console.log("validator:",validator.target)
            // check init state
            expect(await validator.state()).to.be.equal(1);

            // update block
            // let basicLockEnd = await instance.getBasicLockEnd();
            // basicLockEnd = + basicLockEnd.toString();
            // let period = params.releaseCount * params.releasePeriod
            // await ethers.provider.send("evm_mine",[basicLockEnd + period])

            let bal_init = await btr.balanceOf(validator.target);
            expect(bal_init).to.be.equal(0);

            await btr.connect(user3).transfer(user1.address, value * BigInt(2));
            expect(await btr.balanceOf(user1.address)).to.be.eq(value * BigInt(2));
            await btr.connect(user3).approve(instance.target,value * BigInt(2000000))
            await btr.connect(user1).approve(instance.target,value * BigInt(2000000))

            // add stake 
            await instance.connect(user1).addStake(users[0].address,value * BigInt(2));

   
            // wait 16  blocks
            await ethers.provider.send("hardhat_mine",["0x10"]);
            //exit stake
            await instance.connect(user1).exitStaking(users[0].address);

            expect(await validator.state()).to.be.equal(3);
            await ethers.provider.send("hardhat_mine",["0x10"]);
            //claim
 
            await instance.connect(user1).validatorClaimAny(users[0].address);
            expect(await btr.balanceOf(validator.target)).to.be.equal(0);
        });
 

        it("validatorClaimAny mixed delegator and manager", async () => {
            let valContractAddr = await instance.valMaps(users[0].address);
            let validator = valFactory.attach(valContractAddr);
            // update block

            await btr.connect(user3).transfer(user1.address, value * BigInt(2));
            expect(await btr.balanceOf(user1.address)).to.be.eq(value * BigInt(2));
            await btr.connect(user3).transfer(owner.address, value * BigInt(2));
            await btr.connect(user3).approve(instance.target,value * BigInt(2000000))
            await btr.connect(user1).approve(instance.target,value * BigInt(2000000))
            await btr.connect(owner).approve(instance.target,value * BigInt(2000000))


            // add stake 
            await instance.connect(user1).addStake(users[0].address,value * BigInt(2));
            // wait 16  blocks
            await ethers.provider.send("hardhat_mine",["0x10"]);
            // add stake delegate


            await instance.addDelegation(users[0].address,value);
            
            await ethers.provider.send("hardhat_mine",["0x10"]);
            //exit stake
            await instance.connect(user1).exitStaking(users[0].address);
            
            //claim should be success
            await ethers.provider.send("hardhat_mine",["0x10"]);
            await instance.connect(user1).validatorClaimAny(users[0].address);
        });
    });
});