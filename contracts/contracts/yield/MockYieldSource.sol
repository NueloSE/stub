// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IYieldSource} from "../interfaces/IYieldSource.sol";

/**
 * @title  MockYieldSource
 * @notice Stands in for a real venue on Sepolia, where none exists. Accrues at a fixed rate
 *         against a reserve the owner funds up front, so a draw has something to pay out.
 * @dev    The accrual is simulated and openly so — nothing here should be mistaken for a return.
 *         Every number the app shows that originates here is labelled as simulated. Swapping in
 *         the Morpho adapter changes this contract and nothing else.
 */
contract MockYieldSource is IYieldSource, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Simulated annual rate, in basis points.
    uint256 public rateBps;

    /// @notice Only the pool may move principal in and out.
    address public pool;

    IERC20 private immutable _asset;

    uint256 private _principal;
    uint256 private _accruedAt;
    uint256 private _carried;

    error OnlyPool();
    error InsufficientReserve(uint256 wanted, uint256 available);

    event Harvested(uint256 amount);
    event RateUpdated(uint256 rateBps);
    event PoolUpdated(address pool);

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(IERC20 asset_, uint256 rateBps_, address initialOwner) Ownable(initialOwner) {
        _asset = asset_;
        rateBps = rateBps_;
        _accruedAt = block.timestamp;
    }

    function asset() external view returns (address) {
        return address(_asset);
    }

    function totalAssets() external view returns (uint256) {
        return _principal;
    }

    /// @notice Yield earned since the last settle point, capped by what the reserve can pay.
    /// @dev    Accrues against the reserve rather than deployed principal. On Sepolia the pool's
    ///         principal stays wrapped as cUSD and is never handed to a venue, so there is no
    ///         real position to earn on — the reserve is the whole simulation. A live adapter
    ///         would accrue on {totalAssets} instead.
    function accruedYield() public view returns (uint256) {
        uint256 reserve = _asset.balanceOf(address(this));
        uint256 elapsed = block.timestamp - _accruedAt;
        uint256 earned = _carried + (reserve * rateBps * elapsed) / (10_000 * 365 days);
        return earned > reserve ? reserve : earned;
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

    function setRateBps(uint256 rateBps_) external onlyOwner {
        _settle();
        rateBps = rateBps_;
        emit RateUpdated(rateBps_);
    }

    /// @notice Top the reserve up so draws keep paying. Owner pulls from their own balance.
    function fund(uint256 amount) external {
        _asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _settle() private {
        _carried = accruedYield();
        _accruedAt = block.timestamp;
    }
}
