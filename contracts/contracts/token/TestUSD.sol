// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  TestUSD
 * @notice The plain ERC-20 that enters the pool. Six decimals, like the stablecoins this
 *         stands in for.
 * @dev    Carries its own faucet because the bounty requires judges be able to obtain the
 *         test token without asking anyone for it.
 */
contract TestUSD is ERC20, Ownable {
    /// @notice How much a single faucet call hands out.
    uint256 public constant FAUCET_AMOUNT = 1_000e6;

    /// @notice Minimum gap between faucet calls from one address.
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address account => uint256 timestamp) public lastFaucetCall;

    error FaucetCooldown(uint256 availableAt);

    event FaucetDrip(address indexed to, uint256 amount);

    constructor(address initialOwner) ERC20("Test USD", "tUSD") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint the faucet amount to the caller, once per cooldown window.
    function faucet() external {
        uint256 availableAt = lastFaucetCall[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetCall[msg.sender] != 0 && block.timestamp < availableAt) {
            revert FaucetCooldown(availableAt);
        }
        lastFaucetCall[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetDrip(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice When the caller may next use the faucet. Zero means now.
    function faucetAvailableAt(address account) external view returns (uint256) {
        uint256 last = lastFaucetCall[account];
        return last == 0 ? 0 : last + FAUCET_COOLDOWN;
    }

    /// @dev Used to fund the yield source in deployment scripts.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
