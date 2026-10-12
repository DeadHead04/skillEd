<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { withBase } from "vitepress";
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-hero-info-before>
      <p class="hero-eyebrow">AGENT SKILL EVALUATION</p>
    </template>
    <template #home-hero-image>
      <section class="hero-preview" aria-label="Evaluation workflow example">
        <div class="preview-bar">
          <span class="preview-dot" aria-hidden="true"></span>
          <span>skilled / your project</span>
          <span class="preview-label">WORKFLOW</span>
        </div>
        <div class="preview-body">
          <div class="preview-stage">
            <span class="preview-index">01</span>
            <div><h2>Define the expectation</h2><p>One Skill. A set of repeatable cases.</p></div>
          </div>
          <div class="preview-command"><span aria-hidden="true">$ </span><code>skilled validate evals/eval.yaml</code></div>
          <div class="preview-stage">
            <span class="preview-index">02</span>
            <div><h2>Run and inspect</h2><p>Review verdicts alongside the evidence.</p></div>
          </div>
          <div class="preview-command"><span aria-hidden="true">$ </span><code>skilled run evals/eval.yaml</code></div>
          <div class="preview-stage">
            <span class="preview-index">03</span>
            <div><h2>Revise, then compare</h2><p>Let the next run show what changed.</p></div>
          </div>
        </div>
        <div class="preview-footer"><span>CLI + MCP tools + skilled-improve</span><span aria-hidden="true">↗</span></div>
      </section>
    </template>
    <template #home-hero-actions-after>
      <p class="hero-note">macOS · Linux · Windows <span aria-hidden="true">/</span> <a :href="withBase('/guide/installation')">Runtime included</a></p>
    </template>
  </DefaultTheme.Layout>
</template>
