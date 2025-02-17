<template>
  <v-card-text>
    <v-row>
      <v-col cols="12">
        <h2>Select Your Player</h2>
      </v-col>
      <v-col cols="12" sm="4" v-for="player in availablePlayers" :key="player.id">
        <v-btn color="primary" @click="select(player.id)" block>
          {{ player.name }}
        </v-btn>
      </v-col>
    </v-row>
    <!-- Loading state -->
    <v-row v-if="loading">
      <v-col cols="12" class="text-center">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
      </v-col>
    </v-row>
    <!-- Error state -->
    <v-row v-if="error">
      <v-col cols="12">
        <v-alert type="error">
          {{ error }}
        </v-alert>
      </v-col>
    </v-row>
  </v-card-text>
</template>

<script>
export default {
  name: "PlayerSelect",
  data() {
    return {
      availablePlayers: [],
      loading: true,
      error: null,
      WORKER_URL: "https://couptest.sunnynagam1.workers.dev/",
    };
  },
  async created() {
    await this.fetchPlayers();
  },
  methods: {
    async fetchPlayers() {
      this.loading = true;
      this.error = null;
      try {
        const response = await fetch(this.WORKER_URL);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        this.availablePlayers = data.players.map((player) => ({
          id: player.id,
          name: player.name,
        }));
      } catch (error) {
        console.error("Error fetching players:", error);
        this.error = "Failed to load players. Please try again.";
      } finally {
        this.loading = false;
      }
    },
    select(playerId) {
      this.$emit("player-selected", playerId);
    },
  },
};
</script>

<style scoped>
/* Additional component-specific styles */
</style>
