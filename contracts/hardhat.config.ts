import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";

const MNEMONIC: string = vars.get("MNEMONIC", "test test test test test test test test test test test junk");
const INFURA_API_KEY: string = vars.get("INFURA_API_KEY", "");
const SEPOLIA_RPC_URL: string = vars.get(
  "SEPOLIA_RPC_URL",
  INFURA_API_KEY ? `https://sepolia.infura.io/v3/${INFURA_API_KEY}` : "https://ethereum-sepolia-rpc.publicnode.com",
);

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,
  },
  etherscan: {
    // Etherscan V2 uses one key across every supported chain, Sepolia included, so this is a
    // plain string rather than a per-network map. Get one at etherscan.io, not sepolia.etherscan.io.
    apiKey: vars.get("ETHERSCAN_API_KEY", ""),
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic: MNEMONIC,
        count: 20,
      },
      chainId: 31337,
      // The scale test deploys and drives hundreds of depositors in one run.
      allowUnlimitedContractSize: false,
      blockGasLimit: 30_000_000,
    },
    localhost: {
      accounts: {
        mnemonic: MNEMONIC,
        count: 20,
      },
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      accounts: {
        mnemonic: MNEMONIC,
        path: "m/44'/60'/0'/0/",
        count: 10,
      },
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
    },
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: { bytecodeHash: "none" },
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
};

export default config;
