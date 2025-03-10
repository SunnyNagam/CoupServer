const AWS = require("aws-sdk");
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME || "CoupGames";

/**
 * Helper: Get game state from DynamoDB
 */
async function getGameState() {
  const result = await dynamo
    .get({
      TableName: TABLE_NAME,
      Key: { gameId: "default" },
    })
    .promise();
  return result.Item;
}

/**
 * Helper: Save game state to DynamoDB
 */
async function saveGameState(game) {
  await dynamo
    .put({
      TableName: TABLE_NAME,
      Item: game,
    })
    .promise();
}

/**
 * Helper: Shuffle an array (Fisher-Yates)
 */
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Helper: Handle influence loss for a player, allowing them to choose which card to reveal
 * If cardToLose is specified, that card is lost. Otherwise, the first card is lost.
 */
function loseInfluence(player, cardToLose = null) {
  if (player.influence.length === 0) return null;

  let lostCard;
  if (cardToLose && player.influence.includes(cardToLose)) {
    const idx = player.influence.indexOf(cardToLose);
    lostCard = player.influence.splice(idx, 1)[0];
  } else {
    lostCard = player.influence.shift();
  }

  player.revealedInfluence.push(lostCard);
  if (player.influence.length === 0) {
    player.status = "ELIMINATED";
    console.log("\tPlayer: " + player.id + " is eliminated");
  }
  return lostCard;
}

/**
 * Initialize a new game.
 * This version now accepts an optional settings object (e.g., for custom player count or names).
 */
function initializeNewGame(settings = {}) {
  const {
    playerCount = 3,
    playerNames = Array(playerCount)
      .fill()
      .map((_, i) => `Player ${i + 1}`),
  } = settings;

  // Build a deck with 15 cards (3 of each character)
  let deck = [];
  const characters = ["Duke", "Assassin", "Captain", "Ambassador", "Contessa"];
  for (let char of characters) {
    for (let i = 0; i < 3; i++) {
      deck.push(char);
    }
  }
  deck = shuffle(deck);

  // Create players with custom names and assign each 2 coins and 2 hidden influence cards.
  const players = Array(playerCount)
    .fill()
    .map((_, i) => ({
      id: `player${i + 1}`,
      name: playerNames[i],
      coins: 2,
      influence: [deck.pop(), deck.pop()],
      revealedInfluence: [],
      status: "ACTIVE",
    }));

  console.log("\n>>>>>>>>>>>>> DEBUG TURN 1: " + players[0].id + "'s turn");
  console.log(">>> CURRENT PLAYER STATS:");
  players.forEach((player) => {
    console.log(
      `>>> ${player.id} (${player.coins} coins): ${player.influence}` + (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : "")
    );
  });
  console.log("<<<<<<<<<<<<<<<\n");

  // Add formatted history for player's states
  const formattedHistory = [];
  formattedHistory.push("\nROUND 1: It's " + players[0].id + "'s turn. Current player states:");
  for (let player of players) {
    formattedHistory.push(
      `\t${player.id}${player.status === "ELIMINATED" ? " (ELIMINATED)" : ""}: has ${player.coins} coins and ${player.influence.length} influence` +
        (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence.join(", ")})` : "")
    );
  }

  return {
    gameId: "default",
    players, // array of players
    courtDeck: deck, // remaining character cards
    turnIndex: 0, // index into players[] whose turn it is
    turnCount: 1, // number of turns taken
    phase: "ACTION_DECLARATION", // phases: ACTION_DECLARATION, ACTION_RESPONSE, BLOCK_RESPONSE, ACTION_RESOLUTION, GAME_OVER, EXCHANGE_RESPONSE
    pendingAction: null, // holds the current action (and possibly block) info
    actionHistory: [], // log of moves
    formattedHistory: formattedHistory, // formatted history for display
    debug: false, // debug flag
  };
}

/**
 * Utility: Return the player object for a given playerId
 */
function getPlayer(game, playerId) {
  return game.players.find((p) => p.id === playerId);
}

/**
 * Check if only one active player remains. If so, mark game over.
 */
function checkGameOver(game) {
  const activePlayers = game.players.filter((p) => p.status === "ACTIVE");
  if (activePlayers.length <= 1) {
    game.phase = "GAME_OVER";
    game.winner = activePlayers.length === 1 ? activePlayers[0].id : null;
    game.formattedHistory.push(`ROUND ${game.turnCount}: GAME OVER, ${game.winner} wins!!!`);
    console.log("============ GAME OVER:", game.winner, "wins!!!");
    console.log("\nGame History:");
    game.formattedHistory.forEach((entry) => {
      console.log(entry);
    });
  }
  return game;
}

/**
 * Advance to the next active player's turn.
 */
function nextTurn(game) {
  // Clear pending action.
  game.pendingAction = null;
  // Advance turn index.
  let nextIndex = game.turnIndex;
  do {
    nextIndex = (nextIndex + 1) % game.players.length;
  } while (game.players[nextIndex].status !== "ACTIVE");
  game.turnIndex = nextIndex;
  game.phase = "ACTION_DECLARATION";
  game.turnCount++;
  if (game.debug) {
    console.log("\n>>>>>>>>>>>>> DEBUG TURN " + game.turnCount + ": " + game.players[nextIndex].id + "'s turn");
    game.players.forEach((player) => {
      console.log(
        `>>> ${player.id} (${player.coins} coins): ${player.influence}` + (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : "")
      );
    });
    console.log("<<<<<<<<<<<<<<<\n");
  } else {
    console.log("\n>>>>>>>>>>>>> TURN " + game.turnCount + ": It is now player " + game.players[nextIndex].id + "'s turn");
  }
  // Add formatted history for player's states
  game.formattedHistory.push("\nROUND " + game.turnCount + ": It's " + game.players[nextIndex].id + "'s turn. Current player states:");
  for (let player of game.players) {
    game.formattedHistory.push(
      `\t${player.id}${player.status === "ELIMINATED" ? " (ELIMINATED)" : ""}: has ${player.coins} coins and ${player.influence.length} influence` +
        (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence.join(", ")})` : "")
    );
  }
  return game;
}

/**
 * Helper: Create a formatted action history entry
 */
function createHistoryEntry(type, details) {
  return {
    type,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Filter the game state so that a given player sees only their own hidden cards.
 * All other players' hidden influences are replaced with just a count.
 * Also removes internal response tracking from pending actions.
 */
function filterGameStateForPlayer(game, playerId) {
  const cloned = JSON.parse(JSON.stringify(game));

  // Filter player information – show full details only for the requesting player.
  cloned.players = cloned.players.map((p) => {
    if (p.id !== playerId) {
      return {
        id: p.id,
        name: p.name,
        coins: p.coins,
        influenceCount: p.influence.length, // hide hidden influence details
        revealedInfluence: p.revealedInfluence,
        status: p.status,
      };
    }
    return p;
  });

  // Hide exchange options from non-actor players
  if (cloned.pendingAction && cloned.pendingAction.exchangeOptions) {
    if (cloned.pendingAction.actorId !== playerId) {
      delete cloned.pendingAction.exchangeOptions;
    }
  }

  // Hide court deck from non-debug players
  if (cloned.courtDeck) {
    if (playerId !== "debug") {
      delete cloned.courtDeck;
    }
  }

  return cloned;
}

/**
 * Resolve an action challenge (during ACTION_RESPONSE).
 */
function resolveActionChallenge(game, challengerId, cardToLose = null) {
  const pending = game.pendingAction;
  const actor = getPlayer(game, pending.actorId);
  if (actor.influence.includes(pending.claimedCharacter)) {
    // Challenge fails, action passes: challenger loses an influence.
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);

    game.actionHistory.push(
      createHistoryEntry("CHALLENGE", {
        challengedAction: pending.action,
        challenger: challengerId,
        actor: actor.id,
        result: "failed",
        cardLost: lostCard,
        turn: game.turnCount,
      })
    );
    game.formattedHistory.push(
      `ROUND ${game.turnCount}: ${challenger.id} challenged ${actor.id}'s ${pending.action} - Challenge failed, ${challenger.id} loses an influence: ${lostCard}`
    );
    // Actor exchanges the revealed card.
    const idx = actor.influence.indexOf(pending.claimedCharacter);
    if (idx !== -1) {
      actor.influence.splice(idx, 1);
    }
    if (game.courtDeck.length > 0) {
      const newCard = game.courtDeck.pop();
      actor.influence.push(newCard);
      // Instead of concat we now push the revealed card back (as in Cloudflare version)
      game.courtDeck.push(pending.claimedCharacter);
      game.courtDeck = shuffle(game.courtDeck);
    }
    // Clear pending responses and move to resolution.
    game.phase = "ACTION_RESOLUTION";
    console.log("\tAction challenge failed");
  } else {
    // Challenge succeeds, action fails: actor loses an influence.
    const lostCard = loseInfluence(actor, cardToLose);

    game.actionHistory.push(
      createHistoryEntry("CHALLENGE", {
        challengedAction: pending.action,
        challenger: challengerId,
        actor: actor.id,
        result: "succeeded",
        cardLost: lostCard,
        turn: game.turnCount,
      })
    );
    game.formattedHistory.push(
      `ROUND ${game.turnCount}: ${challenger.id} challenged ${actor.id}'s ${pending.action} - Challenge succeeded, ${actor.id} loses an influence: ${lostCard}`
    );
    // Refund coins for the action (except for assassination).
    if (pending.action !== "assassinate") {
      actor.coins += pending.coinCost;
    }
    // Cancel the pending action.
    game.pendingAction = null;
    game.phase = "ACTION_DECLARATION";
    console.log("\tAction challenge succeeded");
  }
  return game;
}

/**
 * Resolve a block challenge (during BLOCK_RESPONSE).
 */
function resolveBlockChallenge(game, challengerId, cardToLose = null) {
  const pending = game.pendingAction;
  const blocker = getPlayer(game, pending.block.blockerId);

  if (blocker.influence.includes(pending.block.claimedCharacter)) {
    // Block challenge fails, challenger loses an influence.
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);

    game.formattedHistory.push(
      `ROUND ${game.turnCount}: ${challenger.id} challenged ${blocker.id}'s block - Challenge failed, ${challenger.id} loses an influence: ${lostCard}`
    );
    // Block stands: the overall action fails.
    game.pendingAction = null;
    game.phase = "ACTION_DECLARATION";
    console.log("\tChallenge of block failed, player " + challengerId + " loses an influence: " + lostCard);
  } else {
    // Block challenge succeeds, blocker loses an influence.
    const lostCard = loseInfluence(blocker, cardToLose);
    game.formattedHistory.push(
      `ROUND ${game.turnCount}: ${challenger.id} challenged ${blocker.id}'s block - Challenge succeeded, ${blocker.id} loses an influence: ${lostCard}`
    );
    // Remove the block so that the original action proceeds.
    pending.block = null;
    game.phase = "ACTION_RESOLUTION"; // challenge of the block succeeded, so block does not go through, so original action proceeds
    console.log("\tChallenge of block succeeded, player " + blocker.id + " loses an influence: " + lostCard);
  }
  return game;
}

/**
 * Execute the pending action (if not blocked or successfully challenged).
 */
function executeAction(game) {
  const pending = game.pendingAction;
  console.log(`\tExecuting action (${pending.action}):`, JSON.stringify(pending));
  const actor = getPlayer(game, pending.actorId);

  switch (pending.action) {
    case "income":
      actor.coins += 1;
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "income",
          turn: game.turnCount,
          actor: actor.id,
        })
      );
      game.formattedHistory.push(`ROUND ${game.turnCount}: ${actor.id} performed income and gained 1 coin, now has ${actor.coins} coins`);
      break;
    case "coup": {
      const target = getPlayer(game, pending.targetId);
      const lostCard = loseInfluence(target, pending.cardToLose);
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "coup",
          turn: game.turnCount,
          actor: actor.id,
          target: pending.targetId,
          cardLost: lostCard,
        })
      );
      game.formattedHistory.push(
        `ROUND ${game.turnCount}: ${actor.id} performed coup on ${target.id} resulting in ${lostCard} being revealed, now has ${actor.coins} coins`
      );
      break;
    }
    case "foreign_aid":
      actor.coins += 2;
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "foreign_aid",
          turn: game.turnCount,
          actor: actor.id,
        })
      );
      game.formattedHistory.push(`ROUND ${game.turnCount}: ${actor.id} performed foreign_aid and gained 2 coins, now has ${actor.coins} coins`);
      break;
    case "tax":
      actor.coins += 3;
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "tax",
          turn: game.turnCount,
          actor: actor.id,
        })
      );
      game.formattedHistory.push(`ROUND ${game.turnCount}: ${actor.id} performed tax and gained 3 coins, now has ${actor.coins} coins`);
      break;
    case "assassinate": {
      const target = getPlayer(game, pending.targetId);
      const lostCard = loseInfluence(target, pending.cardToLose);
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "assassinate",
          turn: game.turnCount,
          actor: actor.id,
          target: pending.targetId,
          cardLost: lostCard,
        })
      );
      game.formattedHistory.push(
        `ROUND ${game.turnCount}: ${actor.id} performed assassination on ${target.id} resulting in ${lostCard} being revealed, now has ${actor.coins} coins`
      );
      break;
    }
    case "steal": {
      const target = getPlayer(game, pending.targetId);
      const amount = Math.min(pending.effect.amount, target.coins);
      target.coins -= amount;
      actor.coins += amount;
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION_RESULT", {
          action: "steal",
          turn: game.turnCount,
          actor: actor.id,
          target: pending.targetId,
          amount: amount,
        })
      );
      game.formattedHistory.push(
        `ROUND ${game.turnCount}: ${actor.id} performed steal from ${target.id} and gained ${amount} coins, now has ${actor.coins} coins`
      );
      break;
    }
    case "exchange": {
      // Draw 2 cards and set up exchange options.
      let drawn = [];
      for (let i = 0; i < 2; i++) {
        if (game.courtDeck.length > 0) {
          drawn.push(game.courtDeck.pop());
        }
      }
      const combined = actor.influence.concat(drawn);
      pending.exchangeOptions = combined;
      // Instead of executing immediately, move to exchange response phase
      game.phase = "EXCHANGE_RESPONSE";
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION", {
          action: "exchange",
          turn: game.turnCount,
          actor: actor.id,
        })
      );
      game.formattedHistory.push(`ROUND ${game.turnCount}: ${actor.id} performed exchange and drew new cards`);
      return game;
    }
    default:
      break;
  }

  // Clear pending action (except for exchange which needs another step)
  if (pending.action !== "exchange") {
    game.pendingAction = null;
  }
  return game;
}

/**
 * Process an action or response based on the current phase.
 */
async function processAction(game, payload) {
  validatePlayerTurn(game, payload);

  switch (game.phase) {
    case "EXCHANGE_RESPONSE":
      return handleExchangeResponse(game, payload);
    case "ACTION_DECLARATION":
      return handleActionDeclaration(game, payload);
    case "ACTION_RESPONSE":
      return handleActionResponse(game, payload);
    case "BLOCK_RESPONSE":
      return handleBlockResponse(game, payload);
    case "ACTION_RESOLUTION":
      throw new Error("Action already being resolved.");
    case "GAME_OVER":
      throw new Error("Game is over.");
    default:
      throw new Error("Invalid game phase.");
  }
}

// Helper functions to break down the large processAction function
function validatePlayerTurn(game, payload) {
  const player = game.players.find((p) => p.id === payload.playerId);
  if (player.status === "ELIMINATED") {
    throw new Error(`Player ${payload.playerId} is eliminated. Cannot make a move.`);
  }
}

function handleActionDeclaration(game, payload) {
  const currentPlayer = game.players[game.turnIndex];
  if (payload.playerId !== currentPlayer.id) {
    throw new Error("Not your turn.");
  }

  // Force coup if player has 10+ coins
  if (currentPlayer.coins >= 10 && payload.action !== "coup") {
    throw new Error("Must perform coup when having 10 or more coins.");
  }

  // Handle immediate actions (income and coup)
  if (payload.action === "income" || payload.action === "coup") {
    return handleImmediateAction(game, payload, currentPlayer);
  }

  // Handle character actions or foreign aid
  return handleCharacterAction(game, payload, currentPlayer);
}

function handleImmediateAction(game, payload, currentPlayer) {
  if (payload.action === "coup") {
    if (!payload.targetId) throw new Error("Target required for coup.");
    if (currentPlayer.coins < 7) throw new Error("Not enough coins to coup.");
    currentPlayer.coins -= 7;
  }

  game.pendingAction = {
    actorId: currentPlayer.id,
    action: payload.action,
    targetId: payload.targetId || null,
  };

  game = executeAction(game);
  game = nextTurn(game);
  game = checkGameOver(game);
  return game;
}

function handleCharacterAction(game, payload, currentPlayer) {
  let pending = {
    actorId: currentPlayer.id,
    action: payload.action,
    claimedCharacter: payload.claimedCharacter || null,
    targetId: payload.targetId || null,
    coinCost: 0,
    effect: {},
    responses: {},
    block: null,
  };

  switch (payload.action) {
    case "foreign_aid":
      pending.effect = { coins: 2 };
      break;
    case "tax":
      if (pending.claimedCharacter !== "Duke") {
        throw new Error("Tax action requires claiming Duke.");
      }
      pending.effect = { coins: 3 };
      break;
    case "assassinate":
      pending.coinCost = 3;
      if (!payload.targetId) throw new Error("Target required for assassination.");
      if (pending.claimedCharacter !== "Assassin") {
        throw new Error("Assassinate action requires claiming Assassin.");
      }
      pending.effect = { type: "assassinate" };
      break;
    case "steal":
      if (!payload.targetId) throw new Error("Target required for steal.");
      if (pending.claimedCharacter !== "Captain") {
        throw new Error("Steal action requires claiming Captain.");
      }
      pending.effect = { type: "steal", amount: 2 };
      break;
    case "exchange":
      if (pending.claimedCharacter !== "Ambassador") {
        throw new Error("Exchange action requires claiming Ambassador.");
      }
      pending.effect = { type: "exchange" };
      break;
    default:
      throw new Error("Unknown action.");
  }

  if (currentPlayer.coins < pending.coinCost) {
    throw new Error("Not enough coins to perform this action.");
  }
  currentPlayer.coins -= pending.coinCost;

  game.pendingAction = pending;
  game.phase = "ACTION_RESPONSE";

  game.actionHistory.push(
    createHistoryEntry("BASIC_ACTION", {
      action: pending.action,
      turn: game.turnCount,
      actor: currentPlayer.id,
      coinCost: pending.coinCost,
      claimedCharacter: pending.claimedCharacter,
      target: pending.targetId || null,
    })
  );
  game.formattedHistory.push(`ROUND ${game.turnCount}: ${currentPlayer.id} is attempting to perform ${pending.action}`);

  return game;
}

function handleActionResponse(game, payload) {
  if (payload.playerId === game.pendingAction.actorId) {
    throw new Error("Actor cannot respond in this phase.");
  }
  const pending = game.pendingAction;
  if (payload.response === "challenge") {
    game = resolveActionChallenge(game, payload.playerId);
    if (game.phase === "ACTION_RESOLUTION") {
      pending.responses[payload.playerId] = "challengeFailed";
      game = executeAction(game);
    } else {
      pending.responses[payload.playerId] = "challengeSucceeded";
    }
    game = nextTurn(game);
    game = checkGameOver(game);
    return game;
  }

  if (payload.response === "block") {
    if (!pending.targetId && pending.action !== "foreign_aid") {
      throw new Error("No valid target for block.");
    }
    if (pending.block) {
      throw new Error("Block has already been declared.");
    }
    pending.block = {
      blockerId: payload.playerId,
      claimedCharacter: payload.claimedCharacter || null,
      responses: {},
    };
    game.phase = "BLOCK_RESPONSE";
    game.actionHistory.push(
      createHistoryEntry("BLOCK", {
        blocker: pending.block.blockerId,
        action: pending.action,
        claimedCharacter: pending.block.claimedCharacter,
        turn: game.turnCount,
      })
    );
    game.formattedHistory.push(
      `ROUND ${game.turnCount}: ${payload.playerId} (claiming ${payload.claimedCharacter}) is attempting to block ${pending.action} from ${pending.actorId}`
    );
    return game;
  }

  pending.responses[payload.playerId] = "pass"; // if not block or challenge, then pass
  const eligible = game.players.filter((p) => p.id !== pending.actorId && p.status === "ACTIVE");
  if (Object.keys(pending.responses).length >= eligible.length) {
    game.phase = "ACTION_RESOLUTION";
    game.formattedHistory.push(
      `ROUND ${game.turnCount}: all eligible players have passed and do not block or challenge ${pending.actorId}'s ${pending.action}`
    );
    console.log("\tAll eligible players have passed, can proceed to action resolution");
    game = executeAction(game);
    if (game.phase === "ACTION_RESOLUTION") {
      game = nextTurn(game);
      game = checkGameOver(game);
    }
    return game;
  }
  return game;
}

function handleBlockResponse(game, payload) {
  // In block response, eligible responders (all active except the blocker) may challenge the block.
  const pending = game.pendingAction;
  if (payload.playerId === pending.block.blockerId) {
    throw new Error("Blocker cannot pass or challenge their own block.");
  }
  if (payload.response === "challenge") {
    game = resolveBlockChallenge(game, payload.playerId, payload.cardToLose);
    if (game.phase === "ACTION_RESOLUTION") {
      console.log("\tBlock is invalid, challenge succeeded, proceed to original action resolution");
      game = executeAction(game);
    } else {
      console.log("\tBlock is valid, challenge failed");
    }
    game = nextTurn(game);
    game = checkGameOver(game);
    return game;
  }
  if (payload.response === "pass") {
    pending.block.responses[payload.playerId] = "pass";
    // Eligible responders for block challenge: all active players except the blocker.
    const eligible = game.players.filter((p) => p.id !== pending.block.blockerId && p.status === "ACTIVE");
    if (Object.keys(pending.block.responses).length >= eligible.length) {
      // No challenge on block: block stands, so the action is canceled.
      game.formattedHistory.push(`ROUND ${game.turnCount}: all players passed, ${pending.block.blockerId}'s block stands, ${pending.action} canceled`);
      game.pendingAction = null;
      game = nextTurn(game);
      game = checkGameOver(game);
      return game;
    }
    return game;
  }
  throw new Error("Invalid response during BLOCK_RESPONSE phase.");
}

// Exchanging player must select cards to keep from the available options from a Get request's pendingAction.exchangeOptions.
function handleExchangeResponse(game, payload) {
  const currentPlayer = game.players[game.turnIndex];
  if (payload.playerId !== currentPlayer.id) {
    throw new Error("Not your turn.");
  }
  const pending = game.pendingAction;
  const actor = getPlayer(game, pending.actorId);
  if (payload.playerId !== actor.id) {
    throw new Error("Only the actor can select exchange options.");
  }
  if (!pending.exchangeOptions) {
    throw new Error("No exchange options available for exchange action.");
  }
  if (!payload.cardsToKeep || !Array.isArray(payload.cardsToKeep) || payload.cardsToKeep.length !== actor.influence.length) {
    throw new Error("Must select exactly " + actor.influence.length + " cards to keep during exchange.");
  }
  for (let card of payload.cardsToKeep) {
    if (!pending.exchangeOptions.includes(card)) {
      throw new Error("Selected card " + card + " is not available in the exchange options.");
    }
  }
  actor.influence = payload.cardsToKeep;
  const returnedCards = pending.exchangeOptions.filter((card) => !payload.cardsToKeep.includes(card));
  game.courtDeck = game.courtDeck.concat(returnedCards);
  game.courtDeck = shuffle(game.courtDeck);
  game.actionHistory.push(
    createHistoryEntry("BASIC_ACTION_RESULT", {
      action: "exchange",
      turn: game.turnCount,
      actor: actor.id,
    })
  );
  game.pendingAction = null;
  game.phase = "ACTION_DECLARATION";
  game = nextTurn(game);
  game = checkGameOver(game);
  return game;
}

/**
 * Filter the game state so that a given player sees only their own hidden cards.
 * Other players' hidden influences are replaced with just a count.
 * Also removes internal response tracking from pending actions.
 */
function logPlayerMove(player, payload) {
  console.log(
    `Received move from ${player.id}: ` +
      JSON.stringify({
        action: payload.action,
        response: payload.response,
        targetId: payload.targetId,
        claimedCharacter: payload.claimedCharacter,
        cardsToKeep: payload.cardsToKeep,
      }) +
      ` ||| Player info: (coins: ${player.coins}, cards: ${player.influence.join(", ")}` +
      (player.revealedInfluence.length ? `, exposed: ${player.revealedInfluence.join(", ")}` : "") +
      `)`
  );
}

/**
 * Lambda handler.
 * Added support for DELETE (new game with custom settings) and CORS headers.
 */
exports.handler = async (event) => {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    // Handle DELETE to reinitialize the game with custom settings.
    if (event.httpMethod === "DELETE") {
      let settings = {};
      if (event.body) {
        settings = JSON.parse(event.body);
      }
      const game = initializeNewGame(settings);
      await saveGameState(game);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(game),
      };
    }

    let game = await getGameState();
    if (!game) {
      // When no game is in the datastore, initialize using default settings.
      game = initializeNewGame();
      await saveGameState(game);
    }

    if (event.httpMethod === "GET") {
      return handleGetRequest(game, event);
    }

    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const player = getPlayer(game, payload.playerId);
      logPlayerMove(player, payload);
      game = await processAction(game, payload);
      await saveGameState(game);
      // Filter the game state so the player only sees their own secret cards.
      game = filterGameStateForPlayer(game, payload.playerId);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(game),
      };
    }

    return {
      statusCode: 405,
      headers: { ...corsHeaders, Allow: "GET, POST, DELETE" },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  } catch (err) {
    console.error("Error processing request:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Helper for GET requests.
function handleGetRequest(game, event) {
  const playerId = event.queryStringParameters?.playerId;
  const responseGame = playerId ? filterGameStateForPlayer(game, playerId) : game;
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(responseGame),
  };
}

// Helper for POST requests.
async function handlePostRequest(game, event) {
  const payload = JSON.parse(event.body);
  const player = getPlayer(game, payload.playerId);
  logPlayerMove(player, payload);
  game = await processAction(game, payload);
  await saveGameState(game);
  // Filter the game state before returning it to the calling player.
  game = filterGameStateForPlayer(game, payload.playerId);
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(game),
  };
}

// Add this at the bottom of the file
if (require.main === module) {
  try {
    // Check if Express is installed
    require.resolve("express");
  } catch (e) {
    console.error("Express is required but not installed. Please run: npm install express");
    process.exit(1);
  }

  const express = require("express");
  const bodyParser = require("body-parser");
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Mock DynamoDB
  let mockGameState = null;

  // Override the DynamoDB functions with in-memory versions
  getGameState = async function () {
    return mockGameState;
  };

  saveGameState = async function (game) {
    mockGameState = game;
    return game;
  };

  // Middleware to parse JSON bodies
  app.use(bodyParser.json());

  // Enable CORS
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // Handle GET, POST, DELETE requests
  app.all("/", async (req, res) => {
    try {
      const event = {
        httpMethod: req.method,
        queryStringParameters: req.query,
        body: JSON.stringify(req.body),
      };

      console.log(`Received ${req.method} request:`, req.method === "GET" ? JSON.stringify(req.query) : JSON.stringify(req.body));

      const lambdaResponse = await exports.handler(event);

      // Set response status code
      res.status(lambdaResponse.statusCode);

      // Set headers
      if (lambdaResponse.headers) {
        Object.entries(lambdaResponse.headers).forEach(([key, value]) => {
          res.header(key, value);
        });
      }

      // Send body
      if (lambdaResponse.body) {
        try {
          const parsedBody = JSON.parse(lambdaResponse.body);
          res.json(parsedBody);
        } catch (e) {
          res.send(lambdaResponse.body);
        }
      } else {
        res.end();
      }
    } catch (error) {
      console.error("Error handling request:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Start the server
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`API endpoints:`);
    console.log(`  GET / - Get game state (use ?playerId=player1 to view as a specific player)`);
    console.log(`  DELETE / - Start a new game (with optional body for settings)`);
    console.log(`  POST / - Process game actions (send JSON body)`);
    console.log(`Example curl commands:`);
    console.log(`  curl -X DELETE http://localhost:${PORT} -H "Content-Type: application/json" -d '{"playerCount":4}'`);
    console.log(`  curl "http://localhost:${PORT}?playerId=player1"`);
    console.log(`  curl -X POST http://localhost:${PORT} -H "Content-Type: application/json" -d '{"playerId":"player1","action":"income"}'`);
  });
}
