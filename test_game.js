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
      { id: "sunny", name: "Player 1", coins: 2, influence: ["Duke", "Assassin"], revealedInfluence: [], status: "ACTIVE" },
      { id: "justin", name: "Player 2", coins: 2, influence: ["Contessa", "Duke"], revealedInfluence: [], status: "ACTIVE" },
      { id: "gibson", name: "Player 3", coins: 2, influence: ["Captain", "Ambassador"], revealedInfluence: [], status: "ACTIVE" },
    ];
  });

  it("should simulate a full game sequence with all responses submitted", async function () {
    let response, game, event, sunny, justin, gibson;

    // --- Turn 1: sunny takes Income ---
    event = createEvent("POST", { playerId: "sunny", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    sunny = game.players.find((p) => p.id === "sunny");
    assert.strictEqual(sunny.coins, 3, "sunny should have 3 coins after income.");
    assert.strictEqual(game.players[game.turnIndex].id, "justin", "Turn should advance to justin");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 2: justin declares Tax (claiming Duke) ---
    event = createEvent("POST", { playerId: "justin", action: "tax", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for tax.");
    assert.strictEqual(game.pendingAction.action, "tax", "Pending action should be tax");
    assert.strictEqual(game.pendingAction.claimedCharacter, "Duke", "Claimed character should be Duke");

    // --- Turn 2a: sunny (non-actor) responds with pass ---
    event = createEvent("POST", { playerId: "sunny", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after sunny passes.");

    // --- Turn 2b: gibson challenges the tax action ---
    event = createEvent("POST", { playerId: "gibson", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    justin = game.players.find((p) => p.id === "justin");
    gibson = game.players.find((p) => p.id === "gibson");
    assert.strictEqual(gibson.revealedInfluence.length, 1, "gibson should have lost one influence due to failed challenge.");
    assert.strictEqual(justin.coins, 5, "justin should have 5 coins after successful tax.");
    assert.strictEqual(game.players[game.turnIndex].id, "gibson", "Turn should advance to gibson");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 3: gibson declares Foreign Aid ---
    event = createEvent("POST", { playerId: "gibson", action: "foreign_aid" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for foreign aid.");
    assert.strictEqual(game.pendingAction.action, "foreign_aid", "Pending action should be foreign_aid");

    // --- Turn 3b: sunny blocks the foreign aid (claiming Duke) ---
    event = createEvent("POST", { playerId: "sunny", response: "block", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after a block is declared.");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Duke", "Block should claim Duke");

    // --- Turn 3c: justin challenges the block ---
    event = createEvent("POST", { playerId: "justin", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    justin = game.players.find((p) => p.id === "justin");
    assert.strictEqual(justin.revealedInfluence.length, 1, "justin should have lost one influence due to failed block challenge.");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "sunny", "Turn should advance to sunny");

    // Test get request
    event = createEvent("GET", null, { playerId: "gibson" });
    response = await handler(event);
    game = JSON.parse(response.body);
    console.log(JSON.stringify(game, null, 2));
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");

    // --- Turn 4: sunny takes Tax ---
    event = createEvent("POST", { playerId: "sunny", action: "tax", claimedCharacter: "Duke" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE");
    assert.strictEqual(game.pendingAction.action, "tax", "Pending action should be tax");

    // --- Turn 4a: Both players pass ---
    event = createEvent("POST", { playerId: "justin", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after first pass");

    event = createEvent("POST", { playerId: "gibson", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    sunny = game.players.find((p) => p.id === "sunny");
    assert.strictEqual(sunny.coins, 6, "sunny should have 6 coins after successful tax");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "justin", "Turn should advance to justin");

    // --- Turn 5: justin takes Income ---
    event = createEvent("POST", { playerId: "justin", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    justin = game.players.find((p) => p.id === "justin");
    assert.strictEqual(justin.coins, 6, "justin should have 6 coins after income");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "gibson", "Turn should advance to gibson");

    // --- Turn 6: gibson uses Ambassador to exchange cards ---
    // first use get to get the exchange options
    event = createEvent("POST", {
      playerId: "gibson",
      action: "exchange",
      claimedCharacter: "Ambassador",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for exchange");
    assert.strictEqual(game.pendingAction.action, "exchange", "Pending action should be exchange");

    // Other players pass on the Ambassador action
    event = createEvent("POST", { playerId: "sunny", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should still be ACTION_RESPONSE after first pass");

    event = createEvent("POST", { playerId: "justin", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "EXCHANGE_RESPONSE", "Phase should be EXCHANGE_RESPONSE after all players pass");

    event = createEvent("GET", null, { playerId: "gibson" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "EXCHANGE_RESPONSE", "Phase should be EXCHANGE_RESPONSE after get");
    console.log("**TEST** Fetched exchange options: " + JSON.stringify(game.pendingAction.exchangeOptions) + "\n");

    event = createEvent("POST", {
      playerId: "gibson",
      action: "exchange",
      claimedCharacter: "Ambassador",
      cardsToKeep: ["Ambassador"],
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    gibson = game.players.find((p) => p.id === "gibson");
    assert.strictEqual(gibson.influence.length, 1, "gibson should still have 1 influence after exchange");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should return to ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "sunny", "Turn should advance to sunny");

    // --- Turn 7: sunny assassinates justin ---
    event = createEvent("POST", {
      playerId: "sunny",
      action: "assassinate",
      targetId: "justin",
      claimedCharacter: "Assassin",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    sunny = game.players.find((p) => p.id === "sunny");
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for assassination");
    assert.strictEqual(sunny.coins, 3, "sunny should have 3 coins after paying for assassination");

    // --- Turn 7a: justin blocks the assassination with Contessa ---
    event = createEvent("POST", {
      playerId: "justin",
      response: "block",
      claimedCharacter: "Contessa",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after block");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Contessa", "Block should claim Contessa");

    // --- Turn 7b: gibson passes on the assassination ---
    event = createEvent("POST", { playerId: "gibson", response: "pass" });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should still be BLOCK_RESPONSE after pass");

    // --- Turn 7c: sunny challenges the block ---
    event = createEvent("POST", { playerId: "sunny", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    sunny = game.players.find((p) => p.id === "sunny");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION after successful block");
    assert.strictEqual(game.players[game.turnIndex].id, "gibson", "Turn should advance to gibson");

    // --- Turn 8: gibson takes income ---
    event = createEvent("POST", { playerId: "gibson", action: "income" });
    response = await handler(event);
    game = JSON.parse(response.body);
    gibson = game.players.find((p) => p.id === "gibson");
    assert.strictEqual(gibson.coins, 3, "gibson should have 3 coins after income");
    assert.strictEqual(game.phase, "ACTION_DECLARATION", "Phase should be ACTION_DECLARATION");
    assert.strictEqual(game.players[game.turnIndex].id, "sunny", "Turn should advance to sunny");

    // --- Turn 9: sunny assassinates gibson ---
    event = createEvent("POST", {
      playerId: "sunny",
      action: "assassinate",
      targetId: "gibson",
      claimedCharacter: "Assassin",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    sunny = game.players.find((p) => p.id === "sunny");
    assert.strictEqual(game.phase, "ACTION_RESPONSE", "Phase should be ACTION_RESPONSE for assassination");
    assert.strictEqual(sunny.coins, 0, "sunny should have 0 coins after paying for assassination");

    // --- Turn 9a: gibson blocks the assassination with Contessa ---
    event = createEvent("POST", {
      playerId: "gibson",
      response: "block",
      claimedCharacter: "Contessa",
    });
    response = await handler(event);
    game = JSON.parse(response.body);
    assert.strictEqual(game.phase, "BLOCK_RESPONSE", "Phase should be BLOCK_RESPONSE after block");
    assert.strictEqual(game.pendingAction.block.claimedCharacter, "Contessa", "Block should claim Contessa");

    // --- Turn 9b: sunny challenges the block ---
    event = createEvent("POST", { playerId: "sunny", response: "challenge" });
    response = await handler(event);
    game = JSON.parse(response.body);
    gibson = game.players.find((p) => p.id === "gibson");
    assert.strictEqual(gibson.status, "ELIMINATED", "gibson should be eliminated after losing challenge");
    assert.strictEqual(game.phase, "GAME_OVER", "Phase should be GAME_OVER");
    assert.strictEqual(game.winner, "sunny", "sunny should be the winner");
  });
});
