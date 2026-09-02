import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { SEPOLIA } from "../config/zama";

/**
 * Deploys Stub.
 *
 * Only two contracts are ours: the pool and its yield source. The confidential token is Zama's
 * `Confidential USDC (Mock)`, already deployed on Sepolia and listed in their Wrappers Registry,
 * whose underlying has a public mint that serves as the faucet. Local networks get clones of
 * both, because the mock FHEVM cannot reach Sepolia.
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts, ethers, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  // Fifteen minutes. A judge visits once; an hourly cadence means they see a stale draw and
  // leave. The owner can shorten it further with `setDrawInterval` when recording the video.
  const DRAW_INTERVAL = 15 * 60;
  const YIELD_RATE_BPS = 1_000; // 10% simulated APR
  const RESERVE = 50_000n * 10n ** 6n;

  const live = network.name === "sepolia";

  let usdcAddress: string;
  let confidentialUsdcAddress: string;

  if (live) {
    usdcAddress = SEPOLIA.usdc;
    confidentialUsdcAddress = SEPOLIA.confidentialUSDC;
    log(`using Zama's deployed tokens`);
    log(`  USD Coin (Mock)          ${usdcAddress}`);
    log(`  Confidential USDC (Mock) ${confidentialUsdcAddress}`);
  } else {
    const usdc = await deploy("MockUSDC", { from: deployer, args: [], log: true });
    const cusdc = await deploy("MockConfidentialUSDC", {
      from: deployer,
      args: [usdc.address],
      log: true,
    });
    usdcAddress = usdc.address;
    confidentialUsdcAddress = cusdc.address;
  }

  const yieldSource = await deploy("MockYieldSource", {
    from: deployer,
    args: [usdcAddress, YIELD_RATE_BPS, deployer],
    log: true,
  });

  const pool = await deploy("StubPool", {
    from: deployer,
    args: [confidentialUsdcAddress, DRAW_INTERVAL, deployer],
    log: true,
  });

  const signer = await ethers.getSigner(deployer);
  const usdcContract = await ethers.getContractAt("MockUSDC", usdcAddress, signer);
  const yieldContract = await ethers.getContractAt("MockYieldSource", yieldSource.address, signer);
  const poolContract = await ethers.getContractAt("StubPool", pool.address, signer);

  if ((await yieldContract.pool()) !== pool.address) {
    log(`wiring yield source -> pool`);
    await (await yieldContract.setPool(pool.address)).wait();
  }

  if ((await poolContract.yieldSource()) !== yieldSource.address) {
    log(`wiring pool -> yield source`);
    await (await poolContract.setYieldSource(yieldSource.address)).wait();
  }

  // Fund the prize reserve from the public mint. Same call on every network.
  const reserve = await usdcContract.balanceOf(yieldSource.address);
  if (reserve < RESERVE) {
    const shortfall = RESERVE - reserve;
    log(`funding prize reserve with ${shortfall} USDCMock`);
    await (await usdcContract.mint(deployer, shortfall)).wait();
    await (await usdcContract.approve(yieldSource.address, shortfall)).wait();
    await (await yieldContract.fund(shortfall)).wait();
  }

  log(`\nStub deployed on ${network.name}:`);
  log(`  StubPool        ${pool.address}`);
  log(`  MockYieldSource ${yieldSource.address}`);
  log(`  cUSDC           ${confidentialUsdcAddress}`);
  log(`  USDC            ${usdcAddress}`);
};

func.id = "deploy_stub";
func.tags = ["Stub"];

export default func;
