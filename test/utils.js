const hre = require("hardhat");
const {BigNumber} = require("ethers");
// const Web3 = require('web3');
// const web3 = new Web3();

// const contractBytecode = '0x...'; // 替换为您的合约字节码

// const deployerAddress = '0x...'; // 替换为您的部署者地址
// const deployerNonce = web3.eth.getTransactionCount(deployerAddress);

// const contractAddress = web3.utils.toChecksumAddress(
//   web3.utils.keccak256(
//     `0x${deployerAddress.slice(2)}${web3.utils.toBN(deployerNonce).toString(16).padStart(64, '0')}`
//   ).slice(-40)
// );


async function getLatestTimestamp() {
    let block = await hre.ethers.provider.send("eth_getBlockByNumber", ['latest', false])
    return block.timestamp;
}
async function getLatestBlockNumber() {
    let block = await hre.ethers.provider.send("eth_getBlockByNumber", ['latest', false])
    return block.number;
}

const takeSnapshot = async () => {
    return await hre.ethers.provider.send('evm_snapshot');
  };
const revertSnapshot = async (id) => {
    await hre.ethers.provider.send('evm_revert', [id]);
  };

async function getLatestCoinbase() {
    return await hre.ethers.provider.send("eth_coinbase",[])
}

async function mineEmptyBlock() {
    await hre.ethers.provider.send("evm_mine");
}
async function getNonce(){
    return await hre.ethers.provider.send("eth_getTransactionCount");
}

function ethToGwei(value) {
    let gwei = hre.ethers.parseUnits(value, 18);
    return gwei;
}

function ethToWei(value) {
    let wei = hre.ethers.parseUnits(value, 18);
    return wei;
}

function weiToEth(value) {
    let eth = hre.ethers.formatUnits(value, 18);
    return eth;
}

function weiToGWei(value) {
    let eth = hre.ethers.formatUnits(value, 9);
    return eth;
}
async function increaseTime(time) {
    await hre.ethers.provider.send("evm_increaseTime",[time])
}

function gweiToWei(value) {
    // Just because ether to Gwei is the same multiple as Gwei to Wei, this is lazy
    return hre.ethers.parseUnits(value, 9);
}
module.exports = {revertSnapshot,takeSnapshot,getLatestTimestamp, getLatestCoinbase, ethToGwei, ethToWei, weiToGWei, weiToEth, gweiToWei, mineEmptyBlock, getNonce, getLatestBlockNumber,increaseTime}