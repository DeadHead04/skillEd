<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { withBase } from "vitepress";
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-info-before>
      <p class="hero-eyebrow">AGENT SKILL EVALUATION</p>
    </template>
    <template #home-hero-actions-after>
      <p class="hero-note">macOS · Linux · Windows <span aria-hidden="true">/</span> <a :href="withBase('/guide/installation')">Runtime included</a></p>
    </template>
  </DefaultTheme.Layout>
</template>
