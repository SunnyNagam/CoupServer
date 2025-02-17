<template>
  <v-app>
    <v-main>
      <v-container class="my-5">
        <v-row justify="center">
          <v-col cols="12" sm="12">
            <v-card class="pa-4">
              <v-card-title class="d-flex justify-space-between align-center">
                <span class="headline">Coup Game</span>
                <v-btn color="error" @click="confirmNewGame" :disabled="isRefreshing"> New Game </v-btn>
              </v-card-title>
              <v-divider></v-divider>
              <!-- Show player select if no player is selected -->
              <div v-if="!currentPlayerId">
                <player-select @player-selected="selectPlayer" />
              </div>
              <!-- Otherwise, show the game interface -->
              <div v-else>
                <game-interface
                  :gameState="gameState"
                  :currentPlayerId="currentPlayerId"
                  :isRefreshing="isRefreshing"
                  @action-performed="performAction"
                  @response-sent="respond"
                  @exchange-submitted="submitExchange"
                  @refresh-requested="refreshGameState"
                />
              </div>
            </v-card>
          </v-col>
        </v-row>
      </v-container>

      <!-- Enhanced New Game Dialog -->
      <v-dialog v-model="showNewGameDialog" max-width="500">
        <v-card>
          <v-card-title>Start New Game</v-card-title>
          <v-card-text>
            <v-form ref="newGameForm" v-model="newGameFormValid">
              <!-- Number of Players -->
              <v-select v-model="newGameSettings.playerCount" :items="[2, 3, 4, 5, 6]" label="Number of Players" required></v-select>

              <!-- Player Names -->
              <v-row v-for="i in newGameSettings.playerCount" :key="i">
                <v-col cols="12">
                  <v-text-field
                    v-model="newGameSettings.playerNames[i - 1]"
                    :label="`Player ${i} Name`"
                    :rules="[(v) => !!v || 'Name is required']"
                    required
                  ></v-text-field>
                </v-col>
              </v-row>
            </v-form>
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="grey darken-1" text @click="showNewGameDialog = false"> Cancel </v-btn>
            <v-btn color="error" @click="startNewGame" :disabled="!newGameFormValid"> Start New Game </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-main>
  </v-app>
</template>

<script>
import PlayerSelect from "./components/PlayerSelect.vue";
import GameInterface from "./components/GameInterface.vue";

export default {
  name: "App",
  components: {
    PlayerSelect,
    GameInterface,
  },
  data() {
    return {
      currentPlayerId: null,
      gameState: null,
      isRefreshing: false,
      showNewGameDialog: false,
      newGameFormValid: false,
      newGameSettings: {
        playerCount: 3,
        playerNames: ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"],
      },
      WORKER_URL: "https://couptest.sunnynagam1.workers.dev/",
    };
  },
  methods: {
    selectPlayer(playerId) {
      this.currentPlayerId = playerId;
      this.refreshGameState();
    },
    async refreshGameState() {
      if (!this.currentPlayerId) return;
      this.isRefreshing = true;
      try {
        const response = await fetch(`${this.WORKER_URL}?playerId=${this.currentPlayerId}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const newState = await response.json();
        // basic validation for the game state
        if (newState && Array.isArray(newState.players)) {
          this.gameState = newState;
        }
      } catch (error) {
        console.error("Error refreshing game state:", error);
      } finally {
        this.isRefreshing = false;
      }
    },
    async performAction(payload) {
      // payload includes (action, targetId, claimedCharacter, etc.)
      if (!this.currentPlayerId || !this.gameState) return;
      try {
        const response = await fetch(this.WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: this.currentPlayerId, ...payload }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.gameState = await response.json();
      } catch (error) {
        console.error("Error performing action:", error);
      }
    },
    async respond(payload) {
      // payload includes { response, claimedCharacter: ... }
      if (!this.currentPlayerId || !this.gameState) return;
      try {
        const response = await fetch(this.WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: this.currentPlayerId, ...payload }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        this.gameState = await response.json();
      } catch (error) {
        console.error("Error sending response:", error);
      }
    },
    async submitExchange(payload) {
      // payload contains; example: { cardsToKeep: [...], action:"exchange", claimedCharacter:"Ambassador" }
      if (!this.currentPlayerId || !this.gameState) return;
      try {
        const response = await fetch(this.WORKER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: this.currentPlayerId, ...payload }),
        });
        this.gameState = await response.json();
      } catch (error) {
        console.error("Error submitting exchange:", error);
      }
    },
    confirmNewGame() {
      this.showNewGameDialog = true;
    },
    async startNewGame() {
      if (!this.$refs.newGameForm.validate()) return;

      this.showNewGameDialog = false;
      this.isRefreshing = true;
      try {
        const response = await fetch(this.WORKER_URL, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            playerCount: this.newGameSettings.playerCount,
            playerNames: this.newGameSettings.playerNames.slice(0, this.newGameSettings.playerCount),
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Reset local state
        this.currentPlayerId = null;
        this.gameState = await response.json();
        console.log("gameState", this.gameState);
      } catch (error) {
        console.error("Error starting new game:", error);
      } finally {
        this.isRefreshing = false;
      }
    },
  },
};
</script>

<style scoped>
/* You can add further custom styles here if needed */
</style>
