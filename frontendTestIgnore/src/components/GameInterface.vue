<template>
  <v-card-text>
    <div v-if="gameState">
      <!-- Add refresh button at the top -->
      <v-row>
        <v-col cols="auto">
          <v-chip class="mr-2">
            Playing as:
            <v-icon left>mdi-account</v-icon>
            {{ gameState.players.find((p) => p.id === currentPlayerId)?.name }}
          </v-chip>
          <v-chip :color="getPhaseColor" dark> Phase: {{ gameState.phase }} </v-chip>
        </v-col>
        <v-col cols="auto" class="ml-auto">
          <v-btn color="primary" @click="$emit('refresh-requested')" :loading="isRefreshing" class="mb-4">
            <v-icon left>mdi-refresh</v-icon>
            Refresh Game
          </v-btn>
        </v-col>
      </v-row>

      <!-- Add status banner for pending actions -->
      <v-alert v-if="gameState.pendingAction" type="info" prominent border="left" class="mb-4">
        <v-row align="center">
          <v-col class="grow">
            <div class="text-h6">{{ getPendingActionPlayer?.name }} is attempting {{ formatPendingAction }}</div>
            <div v-if="gameState.pendingAction.targetId" class="text-subtitle-1">Target: {{ getPendingActionTarget?.name }}</div>
            <div class="text-subtitle-2">Waiting for responses...</div>
          </v-col>
          <v-col v-if="showResponseActions" cols="auto">
            <v-btn v-if="canRespond" color="primary" @click="scrollToResponseActions"> Respond Now </v-btn>
          </v-col>
        </v-row>
      </v-alert>

      <!-- Player Info -->
      <v-row>
        <v-col cols="12" v-for="(player, index) in gameState.players" :key="player.id">
          <v-card
            :class="[
              'player-card',
              player.id === currentPlayerId ? 'current-player' : '',
              player.status !== 'ACTIVE' ? 'eliminated' : '',
              index === gameState.turnIndex ? 'highlight-turn' : '',
            ]"
            :color="index === gameState.turnIndex ? 'green lighten-3' : player.id === currentPlayerId ? 'primary' : 'grey lighten-3'"
          >
            <v-card-text>
              <v-row align="center">
                <v-col cols="auto">
                  <v-avatar :color="index === gameState.turnIndex ? 'green darken-2' : player.id === currentPlayerId ? 'primary darken-2' : 'grey'" size="48">
                    <v-icon large color="white">mdi-account</v-icon>
                  </v-avatar>
                </v-col>
                <v-col>
                  <div class="text-h6">{{ player.name + (player.id === currentPlayerId ? " (You)" : "") }}</div>
                  <v-chip class="mr-2" small>
                    <v-icon left small>mdi-currency-usd</v-icon>
                    {{ player.coins }} coins
                  </v-chip>
                  <v-chip small>
                    <v-icon left small>mdi-cards</v-icon>
                    {{ player.id === currentPlayerId ? (player.influence ? player.influence.join(", ") : player.influenceCount) : player.influenceCount }}
                  </v-chip>
                  <div v-if="player.revealedInfluence && player.revealedInfluence.length" class="mt-2">
                    <v-chip color="error" small label> Revealed: {{ player.revealedInfluence.join(", ") }} </v-chip>
                  </div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Action Buttons -->
      <v-row class="mt-6">
        <v-col cols="12">
          <v-card>
            <v-card-title class="text-h5">Basic Actions</v-card-title>
            <v-card-text>
              <v-row>
                <v-col cols="12" sm="4">
                  <v-btn color="success" @click="onBasicAction('income')" block :disabled="!isCurrentPlayer">
                    <v-icon left>mdi-cash</v-icon>
                    Income (1 coin)
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-btn color="success" @click="onBasicAction('foreign_aid')" block :disabled="!isCurrentPlayer">
                    <v-icon left>mdi-cash-multiple</v-icon>
                    Foreign Aid (2 coins)
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-btn
                    color="error"
                    @click="onBasicAction('coup')"
                    block
                    :disabled="!isCurrentPlayer || gameState.players.find((p) => p.id === currentPlayerId)?.coins < 7"
                  >
                    <v-icon left>mdi-sword</v-icon>
                    Coup (7 coins)
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Character Actions -->
      <v-row class="mt-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="text-h5">Character Actions</v-card-title>
            <v-card-text>
              <v-row>
                <v-col cols="12" sm="3" v-for="(action, index) in characterActions" :key="index">
                  <v-btn :color="action.color" @click="onCharacterAction(action.action, action.character)" block :disabled="!isCurrentPlayer">
                    <v-icon left>{{ action.icon }}</v-icon>
                    {{ action.label }}
                  </v-btn>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Target Selection -->
      <v-row v-if="showTargetSelection" class="mt-4">
        <v-col cols="12">
          <h3>Select Target</h3>
        </v-col>
        <v-col cols="12" sm="4" v-for="player in availableTargets" :key="player.id">
          <v-btn color="info" @click="selectTarget(player.id)" block>
            {{ player.name }}
          </v-btn>
        </v-col>
      </v-row>

      <!-- Exchange Selection -->
      <v-row v-if="gameState.phase === 'EXCHANGE_RESPONSE' && gameState.pendingAction && gameState.pendingAction.exchangeOptions" class="mt-4">
        <v-col cols="12">
          <h3>Select {{ currentPlayerInfluenceCount }} Cards to Keep</h3>
          <v-card class="pa-4">
            <v-row>
              <v-col cols="12" sm="3" v-for="card in gameState.pendingAction.exchangeOptions" :key="card">
                <v-btn
                  :color="selectedExchangeCards.includes(card) ? 'grey' : 'primary'"
                  @click="toggleExchangeCard(card)"
                  block
                  :disabled="isExchangeSelectionDisabled(card)"
                >
                  {{ card }}
                </v-btn>
              </v-col>
            </v-row>
            <v-row class="mt-4">
              <v-col cols="12">
                <v-btn
                  color="success"
                  @click="submitExchange(selectedExchangeCards)"
                  block
                  :disabled="selectedExchangeCards.length !== currentPlayerInfluenceCount"
                >
                  Confirm Selection
                </v-btn>
              </v-col>
            </v-row>
          </v-card>
        </v-col>
      </v-row>

      <!-- Response Actions -->
      <v-row v-if="showResponseActions && canRespond" class="mt-4" id="response-actions">
        <v-col cols="12">
          <h3>Response Actions</h3>
          <!-- Add pending action info -->
          <v-card class="mb-4 pa-4">
            <div class="text-subtitle-1">
              <strong>{{ getPendingActionPlayer?.name }}</strong> is attempting:
              <v-chip class="mx-2" small>
                {{ formatPendingAction }}
              </v-chip>
            </div>
            <div v-if="gameState.pendingAction.block" class="mt-2">
              <strong>{{ getBlockingPlayer?.name }}</strong> is blocking with:
              <v-chip class="mx-2" small>
                {{ gameState.pendingAction.block.claimedCharacter }}
              </v-chip>
            </div>
            <div v-if="gameState.pendingAction.targetId" class="mt-2">
              Target: <strong>{{ getPendingActionTarget?.name }}</strong>
            </div>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6">
          <v-btn color="grey" @click="sendResponse('pass')" block>Pass</v-btn>
        </v-col>
        <v-col cols="12" sm="6">
          <v-btn color="warning" @click="sendResponse('challenge')" block>Challenge</v-btn>
        </v-col>
        <v-col cols="12" sm="4" v-if="showBlockOptions">
          <v-menu offset-y>
            <template v-slot:activator="{ props }">
              <v-btn color="orange" v-bind="props" block> Block Options </v-btn>
            </template>
            <v-list>
              <div v-if="gameState.pendingAction.action === 'foreign_aid'">
                <v-list-item link @click="sendResponse('block', 'Duke')">
                  <v-list-item-title>Block as Duke</v-list-item-title>
                </v-list-item>
              </div>

              <div v-if="gameState.pendingAction.action === 'assassinate'">
                <v-list-item link @click="sendResponse('block', 'Contessa')">
                  <v-list-item-title>Block as Contessa</v-list-item-title>
                </v-list-item>
              </div>

              <div v-if="gameState.pendingAction.action === 'steal'">
                <v-list-item link @click="sendResponse('block', 'Ambassador')">
                  <v-list-item-title>Block as Ambassador</v-list-item-title>
                </v-list-item>
                <v-list-item link @click="sendResponse('block', 'Captain')">
                  <v-list-item-title>Block as Captain</v-list-item-title>
                </v-list-item>
              </div>
            </v-list>
          </v-menu>
        </v-col>
      </v-row>

      <!-- Game Log -->
      <v-row class="mt-4">
        <v-col cols="12">
          <h3>Game Log</h3>
          <v-card class="pa-4" style="max-height: 200px; overflow-y: auto">
            <div v-for="(entry, index) in gameState.formattedHistory" :key="index" class="mb-1">
              {{ entry }}
            </div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Add character card display section -->
      <v-row class="mt-4 mb-4">
        <v-col cols="12">
          <v-card>
            <v-card-title class="text-h5">Character Reference</v-card-title>
            <v-card-text>
              <v-row>
                <v-col v-for="card in characterCards" :key="card.name" cols="12" sm="4" md="2">
                  <v-card :color="card.color" dark>
                    <v-card-title class="text-subtitle-1">{{ card.name }}</v-card-title>
                    <v-card-text>
                      <div>
                        <v-icon left>{{ card.icon }}</v-icon> {{ card.action }}
                      </div>
                      <div class="mt-2 text-caption">{{ card.description }}</div>
                    </v-card-text>
                  </v-card>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </div>
    <div v-else>
      <p>Loading game state...</p>
    </div>
  </v-card-text>
</template>

<script setup>
import { ref, computed } from "vue";

// Props definition
const props = defineProps({
  gameState: Object,
  currentPlayerId: String,
  isRefreshing: {
    type: Boolean,
    default: false,
  },
});

// Emits definition
const emit = defineEmits(["refresh-requested", "action-performed", "response-sent", "exchange-submitted"]);

// Reactive state
const selectedAction = ref(null);
const selectedClaimedCharacter = ref(null);
const selectedExchangeCards = ref([]);

// Computed properties
const showTargetSelection = computed(() => {
  return selectedAction.value && ["assassinate", "steal", "coup"].includes(selectedAction.value);
});

const availableTargets = computed(() => {
  if (!props.gameState) return [];
  return props.gameState.players.filter((player) => player.id !== props.currentPlayerId && player.status === "ACTIVE");
});

const showResponseActions = computed(() => {
  if (!props.gameState) return false;
  return props.gameState.phase === "ACTION_RESPONSE" || props.gameState.phase === "BLOCK_RESPONSE";
});

const showBlockOptions = computed(() => {
  if (!props.gameState?.pendingAction) return false;
  return (
    props.gameState.phase === "ACTION_RESPONSE" &&
    props.gameState.pendingAction.actorId !== props.currentPlayerId &&
    props.gameState.pendingAction.action !== "tax" &&
    props.gameState.pendingAction.action !== "exchange"
  );
});

const isCurrentPlayer = computed(() => {
  return props.gameState && props.gameState.players[props.gameState.turnIndex]?.id === props.currentPlayerId;
});

const characterActions = computed(() => [
  {
    action: "tax",
    character: "Duke",
    label: "Tax (Duke)",
    color: "indigo",
    icon: "mdi-bank",
  },
  {
    action: "assassinate",
    character: "Assassin",
    label: "Assassinate",
    color: "deep-purple",
    icon: "mdi-knife",
  },
  {
    action: "steal",
    character: "Captain",
    label: "Steal",
    color: "blue",
    icon: "mdi-hand-coin",
  },
  {
    action: "exchange",
    character: "Ambassador",
    label: "Exchange",
    color: "teal",
    icon: "mdi-card-multiple",
  },
]);

const currentPlayerInfluenceCount = computed(() => {
  const currentPlayer = props.gameState?.players.find((p) => p.id === props.currentPlayerId);
  return currentPlayer?.influenceCount || currentPlayer?.influence.length;
});

const getPendingActionPlayer = computed(() => {
  if (!props.gameState?.pendingAction) return null;
  return props.gameState.players.find((p) => p.id === props.gameState.pendingAction.actorId);
});

const getPendingActionTarget = computed(() => {
  if (!props.gameState?.pendingAction?.targetId) return null;
  return props.gameState.players.find((p) => p.id === props.gameState.pendingAction.targetId);
});

const getBlockingPlayer = computed(() => {
  if (!props.gameState?.pendingAction?.block) return null;
  return props.gameState.players.find((p) => p.id === props.gameState.pendingAction.block.blockerId);
});

const formatPendingAction = computed(() => {
  const action = props.gameState?.pendingAction;
  if (!action) return "";

  let text = action.action.replace(/_/g, " ");
  if (action.claimedCharacter) {
    text = `${text} as ${action.claimedCharacter}`;
  }
  if (action.coinCost) {
    text = `${text} (${action.coinCost} coins)`;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
});

const canRespond = computed(() => {
  if (!props.gameState?.pendingAction) return false;
  const pendingAction = props.gameState.pendingAction;

  // Handle block response phase
  if (props.gameState.phase === "BLOCK_RESPONSE") {
    // Original actor can respond to blocks of their action
    if (pendingAction.actorId === props.currentPlayerId) {
      return !pendingAction.block?.responses?.[props.currentPlayerId];
    }
    return false;
  }

  // Handle action response phase
  if (props.gameState.phase === "ACTION_RESPONSE") {
    return props.currentPlayerId !== pendingAction.actorId && !pendingAction.responses[props.currentPlayerId];
  }

  return false;
});

// Methods
const onBasicAction = (action) => {
  selectedAction.value = action;
  selectedClaimedCharacter.value = null;
  if (!["coup"].includes(action)) {
    emit("action-performed", { action });
  }
};

const onCharacterAction = (action, claimedCharacter) => {
  selectedAction.value = action;
  selectedClaimedCharacter.value = claimedCharacter;
  if (!["assassinate", "steal", "coup"].includes(action)) {
    emit("action-performed", { action, claimedCharacter });
  }
};

const selectTarget = (targetId) => {
  emit("action-performed", {
    action: selectedAction.value,
    targetId,
    claimedCharacter: selectedClaimedCharacter.value,
  });
  selectedAction.value = null;
  selectedClaimedCharacter.value = null;
};

const sendResponse = (response, claimedCharacter = null) => {
  emit("response-sent", { response, claimedCharacter });
};

const toggleExchangeCard = (card) => {
  if (selectedExchangeCards.value.includes(card)) {
    selectedExchangeCards.value = selectedExchangeCards.value.filter((c) => c !== card);
  } else if (selectedExchangeCards.value.length < currentPlayerInfluenceCount.value) {
    selectedExchangeCards.value.push(card);
  }
};

const isExchangeSelectionDisabled = (card) => {
  console.log("isExchangeSelectionDisabled", card, selectedExchangeCards.value, currentPlayerInfluenceCount.value);
  return !selectedExchangeCards.value.includes(card) && selectedExchangeCards.value.length >= currentPlayerInfluenceCount.value;
};

const submitExchange = (cardsToKeep) => {
  emit("exchange-submitted", {
    action: "exchange",
    claimedCharacter: "Ambassador",
    cardsToKeep,
  });
  selectedExchangeCards.value = [];
};

const scrollToResponseActions = () => {
  document.querySelector("#response-actions")?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
};

// Add character cards reference data
const characterCards = [
  {
    name: "Duke",
    color: "indigo",
    icon: "mdi-bank",
    action: "Tax (3 coins)",
    description: "Can block Foreign Aid",
  },
  {
    name: "Assassin",
    color: "deep-purple",
    icon: "mdi-knife",
    action: "Assassinate (3 coins)",
    description: "Pay 3 coins to eliminate influence",
  },
  {
    name: "Captain",
    color: "blue",
    icon: "mdi-hand-coin",
    action: "Steal (2 coins)",
    description: "Steal 2 coins from another player. Can block stealing.",
  },
  {
    name: "Ambassador",
    color: "teal",
    icon: "mdi-card-multiple",
    action: "Exchange cards",
    description: "Exchange cards with Court deck. Can block stealing.",
  },
  {
    name: "Contessa",
    color: "red",
    icon: "mdi-shield",
    action: "Block Assassination",
    description: "Can block assassination attempts",
  },
];

// Add phase color mapping
const getPhaseColor = computed(() => {
  const phaseColors = {
    ACTION_DECLARATION: "primary",
    ACTION_RESPONSE: "warning",
    BLOCK_RESPONSE: "error",
    EXCHANGE_RESPONSE: "info",
    GAME_OVER: "grey",
  };
  return phaseColors[props.gameState?.phase] || "grey";
});
</script>

<style scoped>
.player-card {
  transition: all 0.3s ease;
}

.player-card.current-player {
  transform: scale(1.02);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.player-card.eliminated {
  opacity: 0.7;
}

.v-btn {
  text-transform: none;
}

/* Add styles for pending action states */
.highlight-pending {
  border: 2px solid var(--v-warning-base) !important;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(255, 193, 7, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 193, 7, 0);
  }
}

/* Add card hover effects */
.v-card {
  transition: transform 0.2s;
}

.v-card:hover {
  transform: translateY(-4px);
}

/* Add phase transition effects */
.v-chip {
  transition: background-color 0.3s;
}
</style>
