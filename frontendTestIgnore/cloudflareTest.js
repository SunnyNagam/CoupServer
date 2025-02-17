// cloudflareWorker.js
// This code implements the Coup game engine as a Cloudflare Worker.
// It uses a Workers KV namespace bound as "GAME_STATE" to persist the game.

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

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
    console.log("Player: " + player.id + " is eliminated");
  }
  return lostCard;
}

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

  // Create players with custom names
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

  console.log("\nDEBUG TURN 1: " + players[0].id + "'s turn");
  console.log("CURRENT PLAYER STATS:");
  players.forEach((player) => {
    console.log(
      `${player.id} (${player.coins} coins): ${player.influence}` + (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : "")
    );
  });

  return {
    gameId: "default",
    players,
    courtDeck: deck,
    turnIndex: 0,
    turnCount: 1,
    phase: "ACTION_DECLARATION",
    pendingAction: null,
    actionHistory: [],
    debug: false,
  };
}

function getPlayer(game, playerId) {
  return game.players.find((p) => p.id === playerId);
}

function checkGameOver(game) {
  const activePlayers = game.players.filter((p) => p.status === "ACTIVE");
  if (activePlayers.length <= 1) {
    game.phase = "GAME_OVER";
    game.winner = activePlayers.length === 1 ? activePlayers[0].id : null;
    console.log("GAME OVER:", game.winner, "wins!!!");
  }
  return game;
}

function nextTurn(game) {
  game.pendingAction = null;
  let nextIndex = game.turnIndex;
  do {
    nextIndex = (nextIndex + 1) % game.players.length;
  } while (game.players[nextIndex].status !== "ACTIVE");
  game.turnIndex = nextIndex;
  game.phase = "ACTION_DECLARATION";
  game.turnCount++;
  if (game.debug) {
    console.log("\nDEBUG TURN " + game.turnCount + ": " + game.players[nextIndex].id + "'s turn");
    game.players.forEach((player) => {
      console.log(
        `${player.id} (${player.coins} coins): ${player.influence}` + (player.revealedInfluence.length ? ` (Exposed: ${player.revealedInfluence})` : "")
      );
    });
  } else {
    console.log("\nTURN " + game.turnCount + ": It is now " + game.players[nextIndex].id + "'s turn");
  }
  return game;
}

function createHistoryEntry(type, details) {
  return {
    type,
    details,
    timestamp: new Date().toISOString(),
  };
}

function formatActionHistory(history) {
  return history.map((entry) => {
    const player = entry.details.actor;
    const target = entry.details.target;
    const coins = entry.details.coinCost;
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    let actionText = `[${time}] `;

    switch (entry.type) {
      case "BASIC_ACTION":
        actionText += `${player} `;

        switch (entry.details.action) {
          case "income":
            actionText += "collected 1 coin (Income)";
            break;
          case "foreign_aid":
            actionText += "attempted to collect 2 coins (Foreign Aid)";
            break;
          case "tax":
            actionText += entry.details.claimedCharacter ? `claimed ${entry.details.claimedCharacter} to collect 3 coins (Tax)` : "collected 3 coins (Tax)";
            break;
          case "assassinate":
            actionText += `paid ${coins} coins to assassinate ${target}`;
            if (entry.details.claimedCharacter) {
              actionText += ` claiming ${entry.details.claimedCharacter}`;
            }
            break;
          case "steal":
            actionText += `attempted to steal from ${target}`;
            if (entry.details.claimedCharacter) {
              actionText += ` claiming ${entry.details.claimedCharacter}`;
            }
            if (entry.details.amount) {
              actionText += ` (${entry.details.amount} coins)`;
            }
            break;
          case "coup":
            actionText += `paid 7 coins to coup ${target}`;
            break;
          case "exchange":
            actionText += "exchanged cards with the court";
            if (entry.details.claimedCharacter) {
              actionText += ` claiming ${entry.details.claimedCharacter}`;
            }
            break;
          default:
            actionText += `performed ${entry.details.action}`;
        }
        return actionText;

      case "CHALLENGE":
        return (
          actionText +
          `${entry.details.challenger} challenged ${entry.details.actor}'s ${entry.details.challengedAction} - ` +
          `Challenge ${entry.details.result}` +
          `${entry.details.cardLost ? ` (${entry.details.challenger} lost ${entry.details.cardLost})` : ""}`
        );

      case "BLOCK":
        return (
          actionText +
          `${entry.details.blocker} blocked ${entry.details.action}` +
          `${entry.details.claimedCharacter ? ` claiming ${entry.details.claimedCharacter}` : ""}`
        );

      default:
        return actionText + JSON.stringify(entry);
    }
  });
}

function filterGameStateForPlayer(game, playerId) {
  const cloned = JSON.parse(JSON.stringify(game));
  // Hide hidden influences for other players
  cloned.players = cloned.players.map((p) => {
    if (p.id !== playerId) {
      return {
        id: p.id,
        name: p.name,
        coins: p.coins,
        influenceCount: p.influence.length,
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
  // Hide the court deck details from non-debug players
  if (cloned.courtDeck && playerId !== "debug") {
    delete cloned.courtDeck;
  }
  cloned.formattedHistory = formatActionHistory(cloned.actionHistory);
  return cloned;
}

function resolveActionChallenge(game, challengerId, cardToLose = null) {
  const pending = game.pendingAction;
  const actor = getPlayer(game, pending.actorId);
  if (actor.influence.includes(pending.claimedCharacter)) {
    // Challenge fails: challenger loses influence
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);
    game.actionHistory.push(
      createHistoryEntry("CHALLENGE", {
        challengedAction: pending.action,
        challenger: challengerId,
        actor: actor.id,
        result: "failed",
        cardLost: lostCard,
      })
    );
    // Replace the revealed card for the actor
    const idx = actor.influence.indexOf(pending.claimedCharacter);
    if (idx !== -1) {
      actor.influence.splice(idx, 1);
    }
    if (game.courtDeck.length > 0) {
      const newCard = game.courtDeck.pop();
      actor.influence.push(newCard);
      game.courtDeck.push(pending.claimedCharacter);
      game.courtDeck = shuffle(game.courtDeck);
    }
    game.phase = "ACTION_RESOLUTION";
    console.log("Action challenge failed");
  } else {
    // Challenge succeeds: actor loses influence
    const lostCard = loseInfluence(actor, cardToLose);
    game.actionHistory.push(
      createHistoryEntry("CHALLENGE", {
        challengedAction: pending.action,
        challenger: challengerId,
        actor: actor.id,
        result: "succeeded",
        cardLost: lostCard,
      })
    );
    if (pending.action !== "assassinate") {
      actor.coins += pending.coinCost;
    }
    game.pendingAction = null;
    game.phase = "ACTION_DECLARATION";
    console.log("Action challenge succeeded");
  }
  return game;
}

function resolveBlockChallenge(game, challengerId, cardToLose = null) {
  const pending = game.pendingAction;
  const blocker = getPlayer(game, pending.block.blockerId);
  if (blocker.influence.includes(pending.block.claimedCharacter)) {
    // Block challenge fails: challenger loses influence
    const challenger = getPlayer(game, challengerId);
    const lostCard = loseInfluence(challenger, cardToLose);
    game.actionHistory.push(
      createHistoryEntry("BLOCK", {
        blocker: pending.block.blockerId,
        action: pending.action,
        claimedCharacter: pending.block.claimedCharacter,
      })
    );
    game.pendingAction = null;
    game.phase = "ACTION_DECLARATION";
    console.log("Challenge of block failed; challenger " + challengerId + " loses influence: " + lostCard);
  } else {
    // Block challenge succeeds: blocker loses influence
    const lostCard = loseInfluence(blocker, cardToLose);
    game.actionHistory.push(
      createHistoryEntry("BLOCK", {
        blocker: pending.block.blockerId,
        action: pending.action,
        claimedCharacter: pending.block.claimedCharacter,
      })
    );
    pending.block = null;
    game.phase = "ACTION_RESOLUTION";
    console.log("Challenge of block succeeded; blocker " + blocker.id + " loses influence: " + lostCard);
  }
  return game;
}

function executeAction(game) {
  const pending = game.pendingAction;
  console.log("Executing action (" + pending.action + "):", JSON.stringify(pending));
  const actor = getPlayer(game, pending.actorId);
  switch (pending.action) {
    case "income":
      actor.coins += 1;
      game.actionHistory.push(createHistoryEntry("BASIC_ACTION", { action: "income", actor: actor.id }));
      break;
    case "coup":
      const target = getPlayer(game, pending.targetId);
      const lostCard = loseInfluence(target, pending.cardToLose);
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION", {
          action: "coup",
          actor: actor.id,
          target: pending.targetId,
          cardLost: lostCard,
        })
      );
      break;
    case "foreign_aid":
      actor.coins += 2;
      game.actionHistory.push(createHistoryEntry("BASIC_ACTION", { action: "foreign_aid", actor: actor.id }));
      break;
    case "tax":
      actor.coins += 3;
      game.actionHistory.push(createHistoryEntry("BASIC_ACTION", { action: "tax", actor: actor.id }));
      break;
    case "assassinate":
      const targetAssassinate = getPlayer(game, pending.targetId);
      const lostCardAssassinate = loseInfluence(targetAssassinate, pending.cardToLose);
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION", {
          action: "assassinate",
          actor: actor.id,
          target: pending.targetId,
          cardLost: lostCardAssassinate,
        })
      );
      break;
    case "steal":
      const targetSteal = getPlayer(game, pending.targetId);
      const amount = Math.min(pending.effect.amount, targetSteal.coins);
      targetSteal.coins -= amount;
      actor.coins += amount;
      game.actionHistory.push(
        createHistoryEntry("BASIC_ACTION", {
          action: "steal",
          actor: actor.id,
          target: pending.targetId,
          amount: amount,
        })
      );
      break;
    case "exchange":
      // Draw 2 cards and present exchange options.
      let drawn = [];
      for (let i = 0; i < 2; i++) {
        if (game.courtDeck.length > 0) {
          drawn.push(game.courtDeck.pop());
        }
      }
      const combined = actor.influence.concat(drawn);
      pending.exchangeOptions = combined;
      game.phase = "EXCHANGE_RESPONSE";
      return game;
    default:
      break;
  }
  if (pending.action !== "exchange") {
    game.pendingAction = null;
  }
  return game;
}

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

function validatePlayerTurn(game, payload) {
  const player = game.players.find((p) => p.id === payload.playerId);
  if (player.status === "ELIMINATED") {
    throw new Error("Player " + payload.playerId + " is eliminated. Cannot make a move.");
  }
}

function handleActionDeclaration(game, payload) {
  const currentPlayer = game.players[game.turnIndex];
  if (payload.playerId !== currentPlayer.id) throw new Error("Not your turn.");
  if (currentPlayer.coins >= 10 && payload.action !== "coup") throw new Error("Must perform coup when having 10 or more coins.");
  if (payload.action === "income" || payload.action === "coup") {
    return handleImmediateAction(game, payload, currentPlayer);
  }
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
      if (pending.claimedCharacter !== "Duke") throw new Error("Tax action requires claiming Duke.");
      pending.effect = { coins: 3 };
      break;
    case "assassinate":
      pending.coinCost = 3;
      if (!payload.targetId) throw new Error("Target required for assassination.");
      if (pending.claimedCharacter !== "Assassin") throw new Error("Assassinate action requires claiming Assassin.");
      pending.effect = { type: "assassinate" };
      break;
    case "steal":
      if (!payload.targetId) throw new Error("Target required for steal.");
      if (pending.claimedCharacter !== "Captain") throw new Error("Steal action requires claiming Captain.");
      pending.effect = { type: "steal", amount: 2 };
      break;
    case "exchange":
      if (pending.claimedCharacter !== "Ambassador") throw new Error("Exchange action requires claiming Ambassador.");
      pending.effect = { type: "exchange" };
      break;
    default:
      throw new Error("Unknown action.");
  }
  if (currentPlayer.coins < pending.coinCost) throw new Error("Not enough coins to perform this action.");
  currentPlayer.coins -= pending.coinCost;
  game.pendingAction = pending;
  game.phase = "ACTION_RESPONSE";
  game.actionHistory.push(
    createHistoryEntry("BASIC_ACTION", {
      action: pending.action,
      actor: currentPlayer.id,
      coinCost: pending.coinCost,
      claimedCharacter: pending.claimedCharacter,
      target: pending.targetId || null,
    })
  );
  return game;
}

function handleActionResponse(game, payload) {
  if (payload.playerId === game.pendingAction.actorId) throw new Error("Actor cannot respond in this phase.");
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
    if (!pending.targetId && pending.action !== "foreign_aid") throw new Error("No valid target for block.");
    if (pending.block) throw new Error("Block has already been declared.");
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
      })
    );
    return game;
  }
  pending.responses[payload.playerId] = "pass";
  const eligible = game.players.filter((p) => p.id !== pending.actorId && p.status === "ACTIVE");
  if (Object.keys(pending.responses).length >= eligible.length) {
    game.phase = "ACTION_RESOLUTION";
    console.log("All eligible players have passed, proceeding to action resolution");
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
  const pending = game.pendingAction;
  if (payload.playerId === pending.block.blockerId) throw new Error("Blocker cannot pass or challenge their own block.");
  if (payload.response === "challenge") {
    game = resolveBlockChallenge(game, payload.playerId);
    if (game.phase === "ACTION_RESOLUTION") {
      console.log("Block is invalid, challenge succeeded, proceeding to action resolution");
      game = executeAction(game);
    } else {
      console.log("Block is valid, challenge failed");
    }
    game = nextTurn(game);
    game = checkGameOver(game);
    return game;
  }
  if (payload.response === "pass") {
    pending.block.responses[payload.playerId] = "pass";
    const eligible = game.players.filter((p) => p.id !== pending.block.blockerId && p.status === "ACTIVE");
    if (Object.keys(pending.block.responses).length >= eligible.length) {
      game.actionHistory.push(
        createHistoryEntry("BLOCK", {
          blocker: pending.block.blockerId,
          action: pending.action,
          claimedCharacter: pending.block.claimedCharacter,
        })
      );
      game.pendingAction = null;
      game = nextTurn(game);
      game = checkGameOver(game);
      return game;
    }
    return game;
  }
  throw new Error("Invalid response during BLOCK_RESPONSE phase.");
}

function handleExchangeResponse(game, payload) {
  const currentPlayer = game.players[game.turnIndex];
  if (payload.playerId !== currentPlayer.id) throw new Error("Not your turn.");
  const pending = game.pendingAction;
  const actor = getPlayer(game, pending.actorId);
  if (payload.playerId !== actor.id) throw new Error("Only the actor can select exchange options.");
  if (!pending.exchangeOptions) throw new Error("No exchange options available for exchange action.");
  if (!payload.cardsToKeep || !Array.isArray(payload.cardsToKeep) || payload.cardsToKeep.length !== actor.influence.length)
    throw new Error("Must select exactly " + actor.influence.length + " cards to keep during exchange.");
  for (let card of payload.cardsToKeep) {
    if (!pending.exchangeOptions.includes(card)) throw new Error("Selected card " + card + " is not available in the exchange options.");
  }
  actor.influence = payload.cardsToKeep;
  const returnedCards = pending.exchangeOptions.filter((card) => !payload.cardsToKeep.includes(card));
  game.courtDeck = game.courtDeck.concat(returnedCards);
  game.courtDeck = shuffle(game.courtDeck);
  game.actionHistory.push(createHistoryEntry("BASIC_ACTION", { action: "exchange", actor: actor.id }));
  game.pendingAction = null;
  game.phase = "ACTION_DECLARATION";
  game = nextTurn(game);
  game = checkGameOver(game);
  return game;
}

function logPlayerMove(player, payload) {
  console.log(player);
  console.log(
    "Received move from " +
      player.id +
      ": " +
      JSON.stringify({
        action: payload.action,
        response: payload.response,
        targetId: payload.targetId,
        claimedCharacter: payload.claimedCharacter,
        cardsToKeep: payload.cardsToKeep,
      }) +
      " ||| Player info: (coins: " +
      player.coins +
      ", cards: " +
      (player.influence ? (player.influence.length ? ", exposed: " + player.influence.join(", ") : "") : "") +
      (player.revealedInfluence.length ? ", exposed: " + player.revealedInfluence.join(", ") : "") +
      ")"
  );
}

// Cloudflare Worker fetch handler using KV for persistence.
// Remember to bind a KV namespace (e.g., "GAME_STATE") when deploying.
export default {
  async fetch(request, env, ctx) {
    try {
      // Add CORS handling
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Add CORS headers to all responses
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      };

      // Modified DELETE method to handle custom game settings
      if (request.method === "DELETE") {
        let settings = {};
        if (request.headers.get("Content-Type")?.includes("application/json")) {
          settings = await request.json();
        }
        const game = initializeNewGame(settings);
        await env.GAME_STATE.put("default", JSON.stringify(game));
        return new Response(JSON.stringify(game), {
          status: 200,
          headers: corsHeaders,
        });
      }

      // Retrieve the current game state from the KV store.
      let gameStr = await env.GAME_STATE.get("default");
      let game = gameStr ? JSON.parse(gameStr) : null;
      if (!game) {
        game = initializeNewGame();
        await env.GAME_STATE.put("default", JSON.stringify(game));
      }
      if (request.method === "GET") {
        const url = new URL(request.url);
        const playerId = url.searchParams.get("playerId");
        console.log(game);
        const responseGame = playerId ? filterGameStateForPlayer(game, playerId) : game;
        return new Response(JSON.stringify(responseGame), {
          status: 200,
          headers: corsHeaders,
        });
      }
      if (request.method === "POST") {
        const payload = await request.json();
        const player = getPlayer(game, payload.playerId);
        logPlayerMove(player, payload);
        game = await processAction(game, payload);
        await env.GAME_STATE.put("default", JSON.stringify(game));
        game = filterGameStateForPlayer(game, payload.playerId);
        return new Response(JSON.stringify(game), {
          status: 200,
          headers: corsHeaders,
        });
      }
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, Allow: "GET, POST" },
      });
    } catch (err) {
      console.error("Error processing request:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        },
      });
    }
  },
};
