# Coup Game Engine

A serverless implementation of the popular board game Coup, built with AWS Lambda and DynamoDB.

## Game Flow

![Game Flow Diagram](GameFlowDiagram.svg)

## Overview

This project implements the core game logic for Coup, handling:

- Turn management
- Action declaration and resolution
- Challenge and block mechanics
- Player state tracking
- Game state persistence

## Technical Stack

- **Runtime**: Node.js
- **Infrastructure**: AWS Lambda
- **Database**: DynamoDB
- **Testing**: Mocha

## API Endpoints

### GET /

Retrieves the current game state. Can be filtered by player ID to hide other players' hidden influences.

Query Parameters:

- `playerId`: ID of the player requesting the state

Example response (with query param `playerId="player3"`):

```
{
  "gameId": "default",
  "players": [
    {
      "id": "player1",
      "name": "Player 1",
      "coins": 3,
      "influenceCount": 2,
      "revealedInfluence": [],
      "status": "ACTIVE"
    },
    {
      "id": "player2",
      "name": "Player 2",
      "coins": 5,
      "influenceCount": 1,
      "revealedInfluence": [
        "Contessa"
      ],
      "status": "ACTIVE"
    },
    {
      "id": "player3",
      "name": "Player 3",
      "coins": 2,
      "influence": [
        "Ambassador"
      ],
      "revealedInfluence": [
        "Captain"
      ],
      "status": "ACTIVE"
    }
  ],
  "courtDeck": [
    "Duke",
    "Captain",
    "Duke",
    "Assassin",
    "Contessa",
    "Contessa",
    "Ambassador",
    "Assassin",
    "Captain"
  ],
  "treasury": {
    "coins": 44
  },
  "turnIndex": 0,
  "turnCount": 4,
  "phase": "ACTION_DECLARATION",
  "pendingAction": null,
  "actionHistory": [
    {
      "actionResolved": "income",
      "actor": "player1"
    },
    {
      "challenge": {
        "challenger": "player3",
        "challenged": "player2",
        "result": "failed",
        "cardLost": "Captain"
      }
    },
    {
      "actionResolved": "tax",
      "actor": "player2"
    },
    {
      "blockDeclared": {
        "blocker": "player1",
        "challenged": "player3",
        "claimedCharacter": "Duke"
      }
    },
    {
      "blockChallenged": {
        "challenger": "player2",
        "blocker": "player1",
        "result": "failed",
        "cardLost": "Contessa"
      }
    }
  ],
  "debug": false
}
```

### POST /

Submits a game action or response. The required fields depend on the current game phase.

Payload:

```json
{
  "playerId": "string", // Required: ID of the player making the move
  "action": "string", // Required during ACTION_DECLARATION phase
  "response": "string", // Required during response phases (challenge/block/pass)
  "claimedCharacter": "string", // Required for character-specific actions/blocks
  "targetId": "string" // Required for targeted actions (coup/steal/assassinate)
}
```

#### Action Phase (ACTION_DECLARATION)

During a player's turn, they must submit one of these actions:

No Character Required:

- `income`: Collect 1 coin
- `foreign_aid`: Collect 2 coins (can be blocked by Duke)
- `coup`: Pay 7 coins to force a player to lose influence (requires targetId)

Character Required (needs claimedCharacter):

- `tax`: Claim Duke to collect 3 coins
- `assassinate`: Claim Assassin to pay 3 coins and make target lose influence (requires targetId)
- `steal`: Claim Captain to steal 2 coins from target (requires targetId)
- `exchange`: Claim Ambassador to exchange cards with the court deck

#### Response Phase (ACTION_RESPONSE)

Other players may respond with:

- `response: "pass"`: Allow the action
- `response: "challenge"`: Challenge the claimed character
- `response: "block"`: Block the action (requires claimedCharacter)

#### Block Response Phase (BLOCK_RESPONSE)

Players may respond to a block with:

- `response: "pass"`: Accept the block
- `response: "challenge"`: Challenge the blocker's claimed character

Example POST requests in a game flow:

```
// Player 1's turn - declares income
POST / {"playerId": "player1", "action": "income"}

// Player 2's turn - claims Duke for tax
POST / {"playerId": "player2", "action": "tax", "claimedCharacter": "Duke"}
POST / {"playerId": "player1", "response": "pass"}
POST / {"playerId": "player3", "response": "challenge"}

// Player 3's turn - attempts assassination
POST / {"playerId": "player3", "action": "assassinate", "claimedCharacter": "Assassin", "targetId": "player1"}
POST / {"playerId": "player1", "response": "block", "claimedCharacter": "Contessa"}
POST / {"playerId": "player2", "response": "pass"}
POST / {"playerId": "player3", "response": "challenge"}
```

## Game Actions

- Income
- Foreign Aid
- Coup
- Tax (Duke)
- Assassinate (Assassin)
- Steal (Captain)
- Exchange (Ambassador)

## Game Phases

1. **ACTION_DECLARATION**: Active player declares an action
2. **ACTION_RESPONSE**: Other players may challenge or block or pass
3. **BLOCK_RESPONSE**: Players may challenge a block or pass
4. **ACTION_RESOLUTION**: Action is executed
5. **GAME_OVER**: Game concludes when only one player remains

## Development

### Setup

1. Install dependencies: `npm install`

### Testing

Run the test suite: `npm test`

### Sample Test Output for example game:

```
sunnynagam@Sunnys-MBP CoopGameManager % npm test

> my-app@1.0.0 test
> mocha test_game.js



  Coup Game Simulator Unit Tests

>>>>>>>>>>>>> DEBUG TURN 1: player1's turn
>>> CURRENT PLAYER STATS:
>>> player1 (2 coins): Captain,Captain
>>> player2 (2 coins): Captain,Duke
>>> player3 (2 coins): Duke,Assassin
<<<<<<<<<<<<<<<

 Received move from player1: {"action":"income"} ||| Player info: (coins: 2, cards: Duke, Assassin)
        Executing action (income): {"actorId":"player1","action":"income","targetId":null}

>>>>>>>>>>>>> TURN 2: It is now player player2's turn
 Received move from player2: {"action":"tax","claimedCharacter":"Duke"} ||| Player info: (coins: 2, cards: Contessa, Duke)
 Received move from player1: {"response":"pass"} ||| Player info: (coins: 3, cards: Duke, Assassin)
 Received move from player3: {"response":"challenge"} ||| Player info: (coins: 2, cards: Captain, Ambassador)
        Action challenge failed
        Executing action (tax): {"actorId":"player2","action":"tax","claimedCharacter":"Duke","targetId":null,"coinCost":0,"effect":{"coins":3,"type":"treasuryToPlayer"},"responses":{"player1":"pass","player3":"challengeFailed"},"block":null}

>>>>>>>>>>>>> TURN 3: It is now player player3's turn
 Received move from player3: {"action":"foreign_aid"} ||| Player info: (coins: 2, cards: Ambassador, exposed: Captain)
 Received move from player1: {"response":"block","claimedCharacter":"Duke"} ||| Player info: (coins: 3, cards: Duke, Assassin)
 Received move from player2: {"response":"challenge"} ||| Player info: (coins: 5, cards: Contessa, Ambassador)
        Challenge of block failed
        Block is invalid, challenge failed

>>>>>>>>>>>>> TURN 4: It is now player player1's turn
 Received move from player1: {"action":"tax","claimedCharacter":"Duke"} ||| Player info: (coins: 3, cards: Duke, Assassin)
 Received move from player2: {"response":"pass"} ||| Player info: (coins: 5, cards: Ambassador, exposed: Contessa)
 Received move from player3: {"response":"pass"} ||| Player info: (coins: 2, cards: Ambassador, exposed: Captain)
        Executing action (tax): {"actorId":"player1","action":"tax","claimedCharacter":"Duke","targetId":null,"coinCost":0,"effect":{"coins":3,"type":"treasuryToPlayer"},"responses":{"player2":"pass","player3":"pass"},"block":null}

>>>>>>>>>>>>> TURN 5: It is now player player2's turn
 Received move from player2: {"action":"income"} ||| Player info: (coins: 5, cards: Ambassador, exposed: Contessa)
        Executing action (income): {"actorId":"player2","action":"income","targetId":null}

>>>>>>>>>>>>> TURN 6: It is now player player3's turn
 Received move from player3: {"action":"exchange","claimedCharacter":"Ambassador"} ||| Player info: (coins: 2, cards: Ambassador, exposed: Captain)
 Received move from player1: {"response":"pass"} ||| Player info: (coins: 6, cards: Duke, Assassin)
 Received move from player2: {"response":"pass"} ||| Player info: (coins: 6, cards: Ambassador, exposed: Contessa)
        Executing action (exchange): {"actorId":"player3","action":"exchange","claimedCharacter":"Ambassador","targetId":null,"coinCost":0,"effect":{"type":"exchange"},"responses":{"player1":"pass","player2":"pass"},"block":null}

>>>>>>>>>>>>> TURN 7: It is now player player1's turn
 Received move from player1: {"action":"assassinate","targetId":"player2","claimedCharacter":"Assassin"} ||| Player info: (coins: 6, cards: Duke, Assassin)
 Received move from player2: {"response":"block","claimedCharacter":"Contessa"} ||| Player info: (coins: 6, cards: Ambassador, exposed: Contessa)
 Received move from player3: {"response":"pass"} ||| Player info: (coins: 2, cards: Ambassador, exposed: Captain)
 Received move from player1: {"response":"challenge"} ||| Player info: (coins: 3, cards: Duke, Assassin)
        Challenge of block succeeded
        Block is invalid, challenge succeeded
        Executing action (assassinate): {"actorId":"player1","action":"assassinate","claimedCharacter":"Assassin","targetId":"player2","coinCost":3,"effect":{"type":"assassinate"},"responses":{},"block":null}

>>>>>>>>>>>>> TURN 8: It is now player player3's turn
 Received move from player3: {"action":"income"} ||| Player info: (coins: 2, cards: Ambassador, exposed: Captain)
        Executing action (income): {"actorId":"player3","action":"income","targetId":null}

>>>>>>>>>>>>> TURN 9: It is now player player1's turn
 Received move from player1: {"action":"assassinate","targetId":"player3","claimedCharacter":"Assassin"} ||| Player info: (coins: 3, cards: Duke, Assassin)
 Received move from player3: {"response":"block","claimedCharacter":"Contessa"} ||| Player info: (coins: 3, cards: Ambassador, exposed: Captain)
 Received move from player1: {"response":"challenge"} ||| Player info: (coins: 0, cards: Duke, Assassin)
        Challenge of block succeeded
        Block is invalid, challenge succeeded
        Executing action (assassinate): {"actorId":"player1","action":"assassinate","claimedCharacter":"Assassin","targetId":"player3","coinCost":3,"effect":{"type":"assassinate"},"responses":{},"block":null}

>>>>>>>>>>>>> TURN 10: It is now player player1's turn
============ GAME OVER: player1 wins!!!
```
