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
  }
  return lostCard;
}

/**
 * Initialize a new game.
 * For simplicity we set up 3 players.
 */
function initializeNewGame() {
  // Build a deck with 15 cards (3 of each character)
  let deck = [];
  const characters = ["Duke", "Assassin", "Captain", "Ambassador", "Contessa"];
  for (let char of characters) {
    for (let i = 0; i < 3; i++) {
      deck.push(char);
    }
  }
  deck = shuffle(deck);

  // Create players; each gets 2 coins and 2 cards (their hidden "influence").
  const players = [
    { id: "player1", name: "Player 1", coins: 2, influence: [deck.pop(), deck.pop()], revealedInfluence: [], status: "ACTIVE" },
    { id: "player2", name: "Player 2", coins: 2, influence: [deck.pop(), deck.pop()], revealedInfluence: [], status: "ACTIVE" },
    { id: "player3", name: "Player 3", coins: 2, influence: [deck.pop(), deck.pop()], revealedInfluence: [], status: "ACTIVE" },
  ];
  console.log("\n>>>>>>>>>>>>> DEBUG TURN 1: " + players[0].id + "'s turn");
  console.log(">>> CURRENT PLAYER STATS:");
  players.forEach((player) => {
    console.log(
      `>>> ${player.id} (${player.coins} coins): ${player.influence}${player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : ""}`
    );
  });
  console.log("<<<<<<<<<<<<<<<\n");

  return {
    gameId: "default",
    players, // array of players
    courtDeck: deck, // remaining character cards
    treasury: { coins: 50 - players.length * 2 }, // treasury after initial coins
    turnIndex: 0, // index into players[] whose turn it is
    turnCount: 1, // number of turns taken
    phase: "ACTION_DECLARATION", // phases: ACTION_DECLARATION, ACTION_RESPONSE, BLOCK_RESPONSE, ACTION_RESOLUTION, GAME_OVER
    pendingAction: null, // holds the current action (and possibly block) info
    actionHistory: [], // log of moves
    debug: false, // Add debug flag
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
    console.log("============ GAME OVER:", game.winner, "wins!!!");
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
  // Only show debug output if debug flag is true
  if (game.debug) {
    console.log("\n>>>>>>>>>>>>> DEBUG TURN " + game.turnCount + ": " + game.players[nextIndex].id + "'s turn");
    game.players.forEach((player) => {
      console.log(
        `>>> ${player.id} (${player.coins} coins): ${player.influence}${player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : ""}`
      );
    });
    console.log("<<<<<<<<<<<<<<<\n");
  } else {
    console.log("\n>>>>>>>>>>>>> TURN " + game.turnCount + ": It is now player " + game.players[nextIndex].id + "'s turn");
  }
  return game;
}

/**
 * Resolve an action challenge (during ACTION_RESPONSE).
 */
function resolveActionChallenge(game, challengerId, cardToLose = null) {
  const pending = game.pendingAction;
  const actor = getPlayer(game, pending.actorId);
  if (actor.influence.includes(pending.claimedCharacter)) {
    // Challenge fails, action passes: challenger loses an influence
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);

    game.actionHistory.push({ challenge: { challenger: challengerId, challenged: actor.id, result: "failed", cardLost: lostCard } });
    // Actor exchanges the revealed card.
    const idx = actor.influence.indexOf(pending.claimedCharacter);
    if (idx !== -1) {
      actor.influence.splice(idx, 1);
    }
    if (game.courtDeck.length > 0) {
      const newCard = game.courtDeck.pop();
      actor.influence.push(newCard);
      game.courtDeck = game.courtDeck.concat(pending.claimedCharacter);
      game.courtDeck = shuffle(game.courtDeck);
    }
    // Clear pending responses and move to resolution.
    game.phase = "ACTION_RESOLUTION";
    console.log("\tAction challenge failed");
  } else {
    // Challenge succeeds, action fails: actor loses an influence
    const lostCard = loseInfluence(actor, cardToLose);

    game.actionHistory.push({ challenge: { challenger: challengerId, challenged: actor.id, result: "succeeded", cardLost: lostCard } });
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
    // Block challenge fails, challenge passes: challenger loses an influence
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);

    game.actionHistory.push({ blockChallenged: { challenger: challengerId, blocker: blocker.id, result: "failed", cardLost: lostCard } });
    // Block stands: the overall action fails.
    game.pendingAction = null;
    game.phase = "ACTION_DECLARATION";
    console.log("\tChallenge of block failed");
  } else {
    // Block challenge succeeds, challenge fails: blocker loses an influence
    const lostCard = loseInfluence(blocker, cardToLose);

    game.actionHistory.push({ blockChallenged: { challenger: challengerId, blocker: blocker.id, result: "succeeded", cardLost: lostCard } });
    // Remove the block so that the original action proceeds.
    pending.block = null;
    game.phase = "ACTION_RESOLUTION"; // challenge of the block succeeded, so block does not go through, so original action proceeds
    console.log("\tChallenge of block succeeded");
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
    case "income": {
      actor.coins += 1;
      game.actionHistory.push({ actionResolved: "income", actor: actor.id });
      break;
    }
    case "coup": {
      const target = getPlayer(game, pending.targetId);
      const lostCard = loseInfluence(target, pending.cardToLose);
      game.actionHistory.push({ actionResolved: "coup", actor: actor.id, target: pending.targetId, cardLost: lostCard });
      break;
    }
    case "foreign_aid": {
      const amt = pending.effect.coins;
      if (game.treasury.coins >= amt) {
        actor.coins += amt;
        game.treasury.coins -= amt;
      } else {
        actor.coins += game.treasury.coins;
        game.treasury.coins = 0;
      }
      game.actionHistory.push({ actionResolved: "foreign_aid", actor: actor.id });
      break;
    }
    case "tax": {
      actor.coins += 3;
      game.actionHistory.push({ actionResolved: "tax", actor: actor.id });
      break;
    }
    case "assassinate": {
      const target = getPlayer(game, pending.targetId);
      const lostCard = loseInfluence(target, pending.cardToLose);
      game.actionHistory.push({ actionResolved: "assassinate", actor: actor.id, target: pending.targetId, cardLost: lostCard });
      break;
    }
    case "steal": {
      const target = getPlayer(game, pending.targetId);
      const amount = Math.min(pending.effect.amount, target.coins);
      target.coins -= amount;
      actor.coins += amount;
      game.actionHistory.push({ actionResolved: "steal", actor: actor.id, target: pending.targetId, amount });
      break;
    }
    case "exchange": {
      // Draw up to 2 cards from the Court deck.
      let drawn = [];
      for (let i = 0; i < 2; i++) {
        if (game.courtDeck.length > 0) {
          drawn.push(game.courtDeck.pop());
        }
      }
      // Combine drawn cards with actor's current influence and shuffle.
      let combined = actor.influence.concat(drawn);
      combined = shuffle(combined);
      // Actor keeps as many cards as originally held.
      const keepCount = actor.influence.length;
      actor.influence = combined.slice(0, keepCount);
      // Return the remaining cards to the Court deck.
      game.courtDeck = game.courtDeck.concat(combined.slice(keepCount));
      game.actionHistory.push({ actionResolved: "exchange", actor: actor.id });
      break;
    }
    default:
      break;
  }
  // Clear pending action.
  game.pendingAction = null;
  return game;
}

/**
 * Process an action or response based on the current phase.
 * @param {Object} game - The current game state
 * @param {Object} payload - The action payload containing:
 *   - playerId: string (required) - ID of the player making the move
 *   - action: string (for new declarations) - One of:
 *     "income", "foreign_aid", "coup", "tax", "assassinate", "steal", "exchange"
 *   - response: string (for responses) - One of "challenge", "block", or "pass"
 *   - claimedCharacter: string (optional) - Required for character actions (e.g., "Duke" for tax)
 *   - targetId: string (optional) - Required for actions targeting another player
 * @throws {Error} If the move is invalid
 * @returns {Object} Updated game state
 */
async function processAction(game, payload) {
  // Identify current actor.
  const currentPlayer = game.players[game.turnIndex];
  // Elimination check
  if (game.players.find((p) => p.id === payload.playerId).status === "ELIMINATED") {
    throw new Error(`Player ${payload.playerId} is eliminated. Cannot make a move.`);
  }
  // PHASE: ACTION_DECLARATION – only the active player may declare a new action.
  if (game.phase === "ACTION_DECLARATION") {
    if (payload.playerId !== currentPlayer.id) {
      throw new Error("Not your turn.");
    }

    // Immediate actions (income and coup)
    if (payload.action === "income" || payload.action === "coup") {
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

    // For character actions or foreign aid, create a pendingAction.
    let pending = {
      actorId: currentPlayer.id,
      action: payload.action,
      claimedCharacter: payload.claimedCharacter || null,
      targetId: payload.targetId || null,
      coinCost: 0,
      effect: {},
      responses: {}, // responses from eligible players (all active except actor)
      block: null, // if a block is declared, will be an object { blockerId, claimedCharacter, responses: {} }
    };

    // Set coin cost/effect.
    switch (payload.action) {
      case "foreign_aid":
        pending.effect = { coins: 2, type: "treasuryToPlayer" };
        break;
      case "tax":
        if (pending.claimedCharacter !== "Duke") {
          throw new Error("Tax action requires claiming Duke.");
        }
        pending.effect = { coins: 3, type: "treasuryToPlayer" };
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
    // Deduct coin cost.
    if (currentPlayer.coins < pending.coinCost) {
      throw new Error("Not enough coins to perform this action.");
    }
    currentPlayer.coins -= pending.coinCost;
    game.pendingAction = pending;
    // Enter ACTION_RESPONSE phase.
    game.phase = "ACTION_RESPONSE";
    return game;
  }

  // PHASE: ACTION_RESPONSE – waiting for responses (challenge, block, or pass) on the declared action.
  if (game.phase === "ACTION_RESPONSE") {
    // Only non-actor players may respond.
    if (payload.playerId === game.pendingAction.actorId) {
      throw new Error("Actor cannot respond in this phase.");
    }
    const pending = game.pendingAction;
    // If a challenge is received, resolve immediately.
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
    // If a block is declared:
    if (payload.response === "block") {
      // In our model, only the target (or any eligible player for foreign aid) may block.
      if (!pending.targetId && pending.action !== "foreign_aid") {
        throw new Error("No valid target for block.");
      }
      if (pending.block) {
        throw new Error("Block has already been declared.");
      }
      // Record block details.
      pending.block = {
        blockerId: payload.playerId,
        claimedCharacter: payload.claimedCharacter || null, // e.g., "Duke" for blocking foreign aid, "Contessa" for assassination block, etc.
        responses: {},
      };
      // Transition to BLOCK_RESPONSE phase.
      game.phase = "BLOCK_RESPONSE";
      game.actionHistory.push({
        blockDeclared: { blocker: pending.block.blockerId, challenged: pending.actorId, claimedCharacter: pending.block.claimedCharacter },
      });
      return game;
    }
    // If response is "pass", record it.
    pending.responses[payload.playerId] = "pass";
    // Check if all eligible players (all active except actor) have responded.
    const eligible = game.players.filter((p) => p.id !== pending.actorId && p.status === "ACTIVE");
    if (Object.keys(pending.responses).length >= eligible.length) {
      // No challenge and no block: proceed to action resolution.
      game.phase = "ACTION_RESOLUTION";
      game = executeAction(game);
      game = nextTurn(game);
      game = checkGameOver(game);
      return game;
    }
    return game;
  }

  // PHASE: BLOCK_RESPONSE – waiting for responses (challenge or pass) on the declared block.
  if (game.phase === "BLOCK_RESPONSE") {
    // In block response, eligible responders (all active except the blocker) may challenge the block.
    const pending = game.pendingAction;
    if (payload.playerId === pending.block.blockerId) {
      throw new Error("Blocker cannot pass or challenge their own block.");
    }
    if (payload.response === "challenge") {
      game = resolveBlockChallenge(game, payload.playerId);
      if (game.phase === "ACTION_RESOLUTION") {
        console.log("\tBlock is invalid, challenge succeeded");
        game = executeAction(game);
      } else {
        console.log("\tBlock is invalid, challenge failed");
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
        game.actionHistory.push({ actionCanceledByBlock: pending.block.blockerId, action: pending.action });
        game.pendingAction = null;
        game = nextTurn(game);
        game = checkGameOver(game);
        return game;
      }
      return game;
    }
    throw new Error("Invalid response during BLOCK_RESPONSE phase.");
  }

  // PHASE: ACTION_RESOLUTION – should not receive new responses.
  if (game.phase === "ACTION_RESOLUTION") {
    throw new Error("Action already being resolved.");
  }

  // PHASE: GAME_OVER – no further moves.
  if (game.phase === "GAME_OVER") {
    throw new Error("Game is over.");
  }

  throw new Error("Invalid game phase.");
}

/**
 * Filter the game state so that a given player sees only their own hidden cards.
 * Other players' hidden influences are replaced with just a count.
 * Also removes internal response tracking from pending actions.
 */
function filterGameStateForPlayer(game, playerId) {
  // Deep clone game state.
  const cloned = JSON.parse(JSON.stringify(game));
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
  // Optionally filter details of pendingAction responses.
  if (cloned.pendingAction && cloned.pendingAction.responses) {
    delete cloned.pendingAction.responses;
  }
  if (cloned.pendingAction && cloned.pendingAction.block && cloned.pendingAction.block.responses) {
    delete cloned.pendingAction.block.responses;
  }
  return cloned;
}

/**
 * Lambda handler.
 */
exports.handler = async (event) => {
  //console.log("Received event:", JSON.stringify(event));
  try {
    let game = await getGameState();
    if (!game) {
      // Create a new game if none exists.
      game = initializeNewGame();
      await saveGameState(game);
    }
    if (event.httpMethod === "GET") {
      const playerId = event.queryStringParameters && event.queryStringParameters.playerId;
      const responseGame = playerId ? filterGameStateForPlayer(game, playerId) : game;
      //console.log(" Received get game state from player:", playerId);
      return {
        statusCode: 200,
        body: JSON.stringify(responseGame),
      };
    } else if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body);
      const player = getPlayer(game, payload.playerId);
      console.log(
        ` Received move from ${player.id}: ${JSON.stringify({
          action: payload.action,
          response: payload.response,
          targetId: payload.targetId,
          claimedCharacter: payload.claimedCharacter,
        })} ||| Player info: (coins: ${player.coins}, cards: ${player.influence.join(", ")}${
          player.revealedInfluence.length ? `, exposed: ${player.revealedInfluence.join(", ")}` : ""
        })`
      );
      game = await processAction(game, payload);
      await saveGameState(game);
      return {
        statusCode: 200,
        body: JSON.stringify(game),
      };
    } else {
      return {
        statusCode: 405,
        headers: { Allow: "GET, POST" },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }
  } catch (err) {
    console.error("Error processing request:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
