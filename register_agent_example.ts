/**
 * x402pulse Agent Registration Integration Guide & Script
 * 
 * This script demonstrates how a Hermes Desktop agent (or companion app)
 * can register its EVM address with the "hermes" tag on the x402pulse API.
 * 
 * Two methods are provided:
 * 1. Unsecured Registration (Quick-start for local development/testing)
 * 2. Cryptographically Secured Registration (EVM message signature for production)
 */

import { ethers } from "ethers"; // Or use 'viem' equivalent

const API_BASE_URL = "https://api.x402pulse.app"; // Production API URL
const AGENT_ADDRESS = "0x742d35cc6634c0532925a3b844bc9e7595f0bee4"; // Replace with Hermes Agent address
const AGENT_PRIVATE_KEY = "0x..."; // Replace with agent's local private key in secure storage

/**
 * Method 1: Unsecured Registration
 * Useful for local development when ALLOW_UNSECURED_REGISTRATION=true.
 * Requires zero cryptography on the client.
 */
async function registerUnsecured(address: string, agentName: string) {
  console.log(`[Unsecured] Registering agent ${address} as 'hermes'...`);
  
  const payload = {
    address: address,
    tag: "hermes",
    metadata: {
      name: agentName,
      version: "0.6.1",
      platform: "desktop-macos"
    }
  };

  try {
    const response = await fetch(`${API_BASE_URL}/agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Registration failed");
    }
    console.log("[Unsecured] Success:", data);
  } catch (error: any) {
    console.error("[Unsecured] Error:", error.message);
  }
}

/**
 * Method 2: Cryptographically Secured Registration (Production)
 * Verifies that the registering entity actually owns the private key
 * corresponding to the agent address. Preventing impersonation.
 */
async function registerSecured(address: string, privateKey: string, agentName: string) {
  console.log(`[Secured] Generating signature for agent ${address}...`);
  
  // 1. Establish the wallet instance
  const wallet = new ethers.Wallet(privateKey);
  if (wallet.address.toLowerCase() != address.toLowerCase()) {
    throw new Error("Private key does not match the provided agent address");
  }

  // 2. Draft the verification message
  // Must match the format expected/provided in registration payload
  const message = `Register Hermes Agent: ${address.toLowerCase()}`;

  // 3. Sign the message (EIP-191 personal_sign standard)
  const signature = await wallet.signMessage(message);
  console.log(`[Secured] Signature generated: ${signature}`);

  // 4. Construct the secure payload
  const payload = {
    address: address,
    tag: "hermes",
    metadata: {
      name: agentName,
      version: "0.6.1",
      platform: "desktop-macos"
    },
    message: message,
    signature: signature
  };

  // 5. Submit to x402pulse
  try {
    const response = await fetch(`${API_BASE_URL}/agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Secure registration failed");
    }
    console.log("[Secured] Success:", data);
  } catch (error: any) {
    console.error("[Secured] Error:", error.message);
  }
}

// ============================================================================
// Execution Example
// To run: npx ts-node register_agent_example.ts
// ============================================================================
async function main() {
  // Try local unsecured registration first
  await registerUnsecured(AGENT_ADDRESS, "Hermes Alpha Companion");
  
  // If private key is available, test secure registration:
  // await registerSecured(AGENT_ADDRESS, AGENT_PRIVATE_KEY, "Hermes Alpha Companion");
}

if (require.main === module) {
  main();
}
