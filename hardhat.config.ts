import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-solpp";
import "solidity-coverage";
const prodConfig = {
  Mainnet: true,
}

const devConfig = {
  Mainnet: false,
}

const contractDefs: { [key: string]: object } = {
  mainnet: prodConfig,
  devnet: devConfig
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  solpp: {
    defs: contractDefs[process.env.NET]
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true,
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        count: 100,
        accountsBalance: "1000000000000000000000000000"
      },
      hardfork: "shanghai"
    }
  }
};

export default config;
