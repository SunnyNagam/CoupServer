// test_game.js
const assert = require("assert");

// We'll use an in-memory fake for our DynamoDB storage.
let fakeGameState = null;

// Mock the AWS SDK and DynamoDB functions BEFORE requiring the lambda module
const AWS = {
  DynamoDB: {
    DocumentClient: function () {
      return {
        get: () => ({ promise: () => Promise.resolve({ Item: fakeGameState }) }),
        put: (params) => ({
          promise: () => {
            fakeGameState = params.Item;
            return Promise.resolve();
          },
        }),
      };
    },
  },
};

// Override the require cache so that when lambdaFile.js requires aws-sdk, it gets our mock.
require.cache[require.resolve("aws-sdk")] = {
  exports: AWS,
};

const { handler } = require("./lambdaFile");

// Also override the module's getGameState and saveGameState functions.
const lambdaModule = require("./lambdaFile");
lambdaModule.getGameState = () => Promise.resolve(fakeGameState);
lambdaModule.saveGameState = (game) => {
  fakeGameState = game;
  return Promise.resolve();
};

// Helper to simulate HTTP events
function createEvent(method, bodyObj, queryParams = {}) {
  return {
    httpMethod: method,
    body: bodyObj ? JSON.stringify(bodyObj) : null,
    queryStringParameters: queryParams,
  };
}

describe("Coup Game Simulator Unit Tests", function () {
  // Before each test, reset our fake game state.
  beforeEach(async function () {
    fakeGameState = null;
    // Force a predictable initial state by initializing a new game
    // then override the players' influences and coins.
    const initEvent = createEvent("GET");
    let initResponse = await handler(initEvent);
    fakeGameState = JSON.parse(initResponse.body);

    // Override players with a known state:
    fakeGameState.players = [
      { id: "player1", name: "Player 1", coins: 2, influence: ["Duke", "Assassin"], revealedInfluence: [], status: "ACTIVE" },
      { id: "player2", name: "Player 2", coins: 2, influence: ["Contessa", "Duke"], revealedInfluence: [], status: "ACTIVE" },
      { id: "player3", name: "Player 3", coins: 2, influence: ["Captain", "Ambassador"], revealedInfluence: [], status: "ACTIVE" },
    ];
  });

  it("should simulate a full game sequence with all responses submitted", async function () {
    let response, game, event, player1, player2, player3;

    // --- Turn 1: Player1 takes Income ---
    event = createEvent("POST", { playerId: "player1", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player1 = game.players.find((p) => p.id === "player1");
    assert.strictEqual(player1.coins, 3, "Player1 should have 3 coins after income.");
    assert.strictEqual(game.players[game.turnIndex].id, "player2", "Turn should advance to player2");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 2: Player2 declares Tax (claiming Duke) ---
    event = createEvent("POST", { playerId: "player2", action: "tax", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for tax.");
    assert.strictEqual(game.pendingAction.action, "tax", "Pending action should be tax");
    assert.strictEqual(game.pendingAction.claimedCharacter, "Duke", "Claimed character should be Duke");

    // --- Turn 2a: Player1 (non-actor) responds with pass ---
    event = createEvent("POST", { playerId: "player1", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after player1 passes.");

    // --- Turn 2b: Player3 challenges the tax action ---
    event = createEvent("POST", { playerId: "player3", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player2 = game.players.find((p) => p.id === "player2");
    player3 = game.players.find((p) => p.id === "player3");
    assert.strictEqual(player3.revealedInfluence.length, 1, "Player3 should have lost one influence due to failed challenge.");
    assert.strictEqual(player2.coins, 5, "Player2 should have 5 coins after successful tax.");
    assert.strictEqual(game.players[game.turnIndex].id, "player3", "Turn should advance to player3");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 3: Player3 declares Foreign Aid ---
    event = createEvent("POST", { playerId: "player3", action: "foreign_aid" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for foreign aid.");
    assert.strictEqual(game.pendingAction.action, "foreign_aid", "Pending action should be foreign_aid");

    // --- Turn 3b: Player1 blocks the foreign aid (claiming Duke) ---
    event = createEvent("POST", { playerId: "player1", response: "block", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after a block is declared.");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Duke", "Block should claim Duke");

    // --- Turn 3c: Player2 challenges the block ---
    event = createEvent("POST", { playerId: "player2", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player2 = game.players.find((p) => p.id === "player2");
    assert.strictEqual(player2.revealedInfluence.length, 1, "Player2 should have lost one influence due to failed block challenge.");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "player1", "Turn should advance to player1");

    // Test get request
    event = createEvent("GET", null, { playerId: "player3" });
    response = await handler(event);
    game = JSON.parse(response.body);
    console.log(JSON.stringify(game, null, 2));
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 4: Player1 takes Tax ---
    event = createEvent("POST", { playerId: "player1", action: "tax", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE");
    assert.strictEqual(game.pendingAction.action, "tax", "Pending action should be tax");

    // --- Turn 4a: Both players pass ---
    event = createEvent("POST", { playerId: "player2", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after first pass");

    event = createEvent("POST", { playerId: "player3", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player1 = game.players.find((p) => p.id === "player1");
    assert.strictEqual(player1.coins, 6, "Player1 should have 6 coins after successful tax");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "player2", "Turn should advance to player2");

    // --- Turn 5: Player2 takes Income ---
    event = createEvent("POST", { playerId: "player2", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player2 = game.players.find((p) => p.id === "player2");
    assert.strictEqual(player2.coins, 6, "Player2 should have 6 coins after income");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "player3", "Turn should advance to player3");

    // --- Turn 6: Player3 uses Ambassador to exchange cards ---
    event = createEvent("POST", {
      playerId: "player3",
      action: "exchange",
      claimedCharacter: "Ambassador",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for exchange");
    assert.strictEqual(game.pendingAction.action, "exchange", "Pending action should be exchange");
    assert.strictEqual(game.pendingAction.claimedCharacter, "Ambassador", "Claimed character should be Ambassador");

    // Other players pass on the Ambassador action
    event = createEvent("POST", { playerId: "player1", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after first pass");

    event = createEvent("POST", { playerId: "player2", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player3 = game.players.find((p) => p.id === "player3");
    assert.strictEqual(player3.influence.length, 1, "Player3 should still have 1 influence after exchange");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should return to ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "player1", "Turn should advance to player1");

    // --- Turn 7: Player1 assassinates player2 ---
    event = createEvent("POST", {
      playerId: "player1",
      action: "assassinate",
      targetId: "player2",
      claimedCharacter: "Assassin",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    player1 = game.players.find((p) => p.id === "player1");
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for assassination");
    assert.strictEqual(player1.coins, 3, "Player1 should have 3 coins after paying for assassination");

    // --- Turn 7a: Player2 blocks the assassination with Contessa ---
    event = createEvent("POST", {
      playerId: "player2",
      response: "block",
      claimedCharacter: "Contessa",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after block");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Contessa", "Block should claim Contessa");

    // --- Turn 7b: Player3 passes on the assassination ---
    event = createEvent("POST", { playerId: "player3", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should still be BLOCK_RESPONSE after pass");

    // --- Turn 7c: Player1 challenges the block ---
    event = createEvent("POST", { playerId: "player1", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player1 = game.players.find((p) => p.id === "player1");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION after successful block");
    assert.strictEqual(game.players[game.turnIndex].id, "player3", "Turn should advance to player3");

    // --- Turn 8: Player3 takes income ---
    event = createEvent("POST", { playerId: "player3", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player3 = game.players.find((p) => p.id === "player3");
    assert.strictEqual(player3.coins, 3, "Player3 should have 3 coins after income");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "player1", "Turn should advance to player1");

    // --- Turn 9: Player1 assassinates player3 ---
    event = createEvent("POST", {
      playerId: "player1",
      action: "assassinate",
      targetId: "player3",
      claimedCharacter: "Assassin",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    player1 = game.players.find((p) => p.id === "player1");
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for assassination");
    assert.strictEqual(player1.coins, 0, "Player1 should have 0 coins after paying for assassination");

    // --- Turn 9a: Player3 blocks the assassination with Contessa ---
    event = createEvent("POST", {
      playerId: "player3",
      response: "block",
      claimedCharacter: "Contessa",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after block");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Contessa", "Block should claim Contessa");

    // --- Turn 9b: Player1 challenges the block ---
    event = createEvent("POST", { playerId: "player1", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    player3 = game.players.find((p) => p.id === "player3");
    assert.strictEqual(player3.status, "ELIMINATED", "Player3 should be eliminated after losing challenge");
    assert.strictEqual(game.phase, "GAME_OVER", "Phase should be GAME_OVER");
    assert.strictEqual(game.winner, "player1", "Player1 should be the winner");
  });
});
