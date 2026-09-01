// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

/**
 * @title  IYieldSource
 * @notice Where the prize comes from. The pool's principal is never at risk, so the only thing
 *         a draw can pay out is yield earned on idle deposits.
 *
 * @dev    Deliberately narrow, and denominated in the *underlying* ERC-20 rather than the
 *         confidential wrapper. A yield venue has no reason to understand ERC-7984; the pool
 *         wraps what it harvests. That keeps this interface satisfiable by a real venue.
 *
 *         Sepolia has no real yield, so {MockYieldSource} accrues at a fixed rate against an
 *         admin-funded reserve — which the bounty explicitly permits. The mainnet path is the
 *         Steakhouse Confidential Prime USDC vault on Morpho (`csteakcUSDC`), Zama's own
 *         flagship confidential yield product: `deposit` supplies the vault, `harvest` redeems
 *         the shares' accrued interest, `totalAssets` reads the position. Nothing in the pool
 *         changes when the implementation does.
 */
interface IYieldSource {
    /// @notice The ERC-20 this source accepts and pays out in.
    function asset() external view returns (address);

    /// @notice Principal currently deployed, in `asset` units.
    function totalAssets() external view returns (uint256);

    /// @notice Yield earned and not yet harvested, in `asset` units.
    function accruedYield() external view returns (uint256);

    /// @notice Supply `amount` of `asset`, pulled from the caller.
    function deposit(uint256 amount) external;

    /// @notice Redeem `amount` of principal back to the caller.
    function withdraw(uint256 amount) external;

    /// @notice Send all accrued yield to the caller and return how much moved.
    function harvest() external returns (uint256);
}
