// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IYieldSource} from "../interfaces/IYieldSource.sol";

/**
 * @title  MockYieldSource
 * @notice An admin-funded prize reserve that releases a fixed amount per second. Stands in for a
 *         real venue on Sepolia, where none exists.
 *
 * @dev    This is a drip, not a rate of return, and the distinction is deliberate. An APR-shaped
 *         mock reads as more realistic but does not survive contact with a fifteen-minute draw:
 *         900 seconds is a rounding error against a year, so any believable APR pays a prize of a
 *         few cents, and reaching a prize worth looking at would need a rate nobody would print.
 *         A drip is calibrated directly against the draw interval, and is obviously simulated
 *         rather than dressed up as a return.
 *
 *         The bounty permits exactly this — "a mock yield source on Sepolia is acceptable (e.g.,
 *         an admin-funded prize reserve)". The app labels every figure originating here as
 *         simulated.
 *
 *         {IYieldSource} is unchanged. A live adapter accrues from a venue's position instead,
 *         and nothing in {StubPool} knows the difference. The Steakhouse Confidential Prime USDC
 *         vault on Morpho is the intended mainnet implementation; unlike this contract, its yield
 *         scales with deposits.
 */
contract MockYieldSource is IYieldSource, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Asset units released per second, capped by what the reserve actually holds.
    uint256 public dripPerSecond;

    /// @notice Only the pool may move principal in and out.
    address public pool;

    IERC20 private immutable _asset;

    uint256 private _principal;
    uint256 private _accruedAt;
    uint256 private _carried;

    error OnlyPool();
    error InsufficientReserve(uint256 wanted, uint256 available);

    event Harvested(uint256 amount);
    event DripUpdated(uint256 dripPerSecond);
    event PoolUpdated(address pool);

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(IERC20 asset_, uint256 dripPerSecond_, address initialOwner) Ownable(initialOwner) {
        _asset = asset_;
        dripPerSecond = dripPerSecond_;
        _accruedAt = block.timestamp;
    }

    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalAssets() external view returns (uint256) {
        return _principal;
    }

    /// @notice What the next draw would pay, capped by the reserve.
    function accruedYield() public view returns (uint256) {
        uint256 reserve = _asset.balanceOf(address(this));
        uint256 earned = _carried + (block.timestamp - _accruedAt) * dripPerSecond;
        return earned > reserve ? reserve : earned;
    }

    /// @notice What one full draw interval is worth at the current drip. For display.
    function prizePerInterval(uint256 interval) external view returns (uint256) {
        return interval * dripPerSecond;
    }

    /// @notice How long the reserve lasts at the current drip, in seconds.
    function runwaySeconds() external view returns (uint256) {
        if (dripPerSecond == 0) return type(uint256).max;
        return _asset.balanceOf(address(this)) / dripPerSecond;
    }

    function deposit(uint256 amount) external onlyPool {
        _settle();
        _asset.safeTransferFrom(msg.sender, address(this), amount);
        _principal += amount;
    }

    function withdraw(uint256 amount) external onlyPool {
        _settle();
        if (amount > _principal) revert InsufficientReserve(amount, _principal);
        _principal -= amount;
        _asset.safeTransfer(msg.sender, amount);
    }

    function harvest() external onlyPool returns (uint256) {
        _settle();
        uint256 amount = _carried;
        uint256 reserve = _asset.balanceOf(address(this));
        if (amount > reserve) amount = reserve;

        _carried -= amount;
        if (amount > 0) _asset.safeTransfer(msg.sender, amount);

        emit Harvested(amount);
        return amount;
    }

    function setPool(address pool_) external onlyOwner {
        pool = pool_;
        emit PoolUpdated(pool_);
    }

    function setDripPerSecond(uint256 dripPerSecond_) external onlyOwner {
        _settle();
        dripPerSecond = dripPerSecond_;
        emit DripUpdated(dripPerSecond_);
    }

    /// @notice Top the reserve up so draws keep paying. Pulled from the caller.
    function fund(uint256 amount) external {
        _asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _settle() private {
        _carried = accruedYield();
        _accruedAt = block.timestamp;
    }
}
