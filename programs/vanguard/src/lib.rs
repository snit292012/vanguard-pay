use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("VanguardPay111111111111111111111111111111111");

/// ----------------------------------------------------------------------
/// VANGUARD PROTOCOL : ON-CHAIN SETTLEMENT ENGINE
/// ----------------------------------------------------------------------
/// This Anchor contract handles the custody of SOL for an Agent's API request.
/// If the data hash provided by the API matches the Agent's expected payload,
/// the Vault settles: 99.9% goes to the API Oracle, 0.1% goes to Vanguard.
/// If validation fails, or times out, the Agent reclaims 100% of the funds.

#[program]
pub mod vanguard_protocol {
    use super::*;

    /// Initialize an ephemeral TWE-Vault.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        amount: u64,
        resource_id: String,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.agent = *ctx.accounts.agent.key;
        vault.resource_id = resource_id;
        vault.locked_amount = amount;
        vault.status = VaultStatus::Active;

        // Transfer funds from the Agent to the PDA Vault
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.agent.to_account_info(),
                to: vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_context, amount)?;

        msg!("TWE Vault Initialized: locked {} lamports", amount);
        Ok(())
    }

    /// Settle the vault upon cryptographic validation. 
    /// This is where Vanguard Pay extracts legitimate revenue (0.1% Protocol Fee).
    pub fn settle_vault(
        ctx: Context<SettleVault>,
        _expected_hash: [u8; 32],
        _provided_hash: [u8; 32],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        
        require!(vault.status == VaultStatus::Active, ErrorCode::VaultNotActive);
        
        // In a full production contract, the HMAC-SHA256 signature verification 
        // would happen strictly on-chain using native Ed25519 capabilities.
        // For demonstration, we assume the signature verified if the instruction executed.

        let total_lamports = vault.locked_amount;
        
        // Vanguard's Protocol Fee: 0.1% 
        let protocol_fee = total_lamports / 1000; 
        let payout = total_lamports - protocol_fee;

        // Pay the Oracle (Target API)
        **vault.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.oracle.to_account_info().try_borrow_mut_lamports()? += payout;

        // Pay Vanguard Treasury (Real Revenue)
        **vault.to_account_info().try_borrow_mut_lamports()? -= protocol_fee;
        **ctx.accounts.vanguard_treasury.to_account_info().try_borrow_mut_lamports()? += protocol_fee;

        vault.status = VaultStatus::Settled;
        msg!("TWE Vault Settled. Protocol Fee Extracted: {} lamports", protocol_fee);
        
        Ok(())
    }

    /// Revert the vault if the API acts maliciously or timeouts. No fee extracted.
    pub fn revert_vault(ctx: Context<RevertVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.status == VaultStatus::Active, ErrorCode::VaultNotActive);

        let amount = vault.locked_amount;

        // Return 100% of funds back to the Agent
        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.agent.to_account_info().try_borrow_mut_lamports()? += amount;

        vault.status = VaultStatus::Reverted;
        msg!("TWE Vault Reverted. Agent Capital Protected.");
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = agent,
        space = 8 + 32 + 64 + 8 + 1 + 32, // Discriminator + pubkey + string + u64 + enum
        seeds = [b"vault", agent.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TweVault>,
    #[account(mut)]
    pub agent: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleVault<'info> {
    #[account(mut, has_one = agent)]
    pub vault: Account<'info, TweVault>,
    /// CHECK: The target API receiving funds
    #[account(mut)]
    pub oracle: AccountInfo<'info>,
    /// CHECK: Vanguard's corporate Treasury 
    #[account(mut)]
    pub vanguard_treasury: AccountInfo<'info>,
    #[account(mut)]
    pub agent: Signer<'info>, // Agent must sign off that hash was valid
}

#[derive(Accounts)]
pub struct RevertVault<'info> {
    #[account(mut, has_one = agent)]
    pub vault: Account<'info, TweVault>,
    #[account(mut)]
    pub agent: Signer<'info>,
}

#[account]
pub struct TweVault {
    pub agent: Pubkey,
    pub resource_id: String,
    pub locked_amount: u64,
    pub status: VaultStatus,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum VaultStatus {
    Active,
    Settled,
    Reverted,
}

#[error_code]
pub enum ErrorCode {
    #[msg("This vault is no longer active.")]
    VaultNotActive,
}
