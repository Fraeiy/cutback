import type { PresentedProject } from "./types.js";

export const VOICE_TOOLS = [
  {
    type: "function",
    name: "read_project_context",
    description:
      "Read the current edit, sentence list, playhead captured when the creator started speaking, and pause marks. Call this when you need sentence ids or the playback moment.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "find_transcript_segment",
    description:
      "Locate a sentence, quote, timestamp, or the section at the captured playhead. Highlights it. Does not change the edit.",
    parameters: {
      type: "object",
      properties: {
        use: {
          type: "string",
          enum: ["auto", "quote", "sentence", "timestamps", "playback", "selection", "last_target"],
          description: "How to choose the section. auto prefers a selection, then a quote, then the captured playhead.",
        },
        quote: { type: "string", description: "Exact words to find, lowercase or mixed. Example: i tested this tool yesterday" },
        sentence_id: { type: "string", description: "Sentence id from read_project_context, such as s02." },
        start_ms: { type: "integer", description: "Source start in milliseconds, not edited-timeline time." },
        end_ms: { type: "integer", description: "Source end in milliseconds." },
        sentence_offset: {
          type: "integer",
          description: "Move from the resolved sentence. -1 is the previous sentence, 1 is the next.",
        },
      },
    },
  },
  {
    type: "function",
    name: "propose_cut",
    description:
      "Cut the video. trim_before makes the video start at the phrase. trim_after makes it end at the phrase. remove deletes that section. Applies immediately when the target is unique. Returns needs_clarification instead of cutting when more than one section matches.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["remove", "trim_before", "trim_after"],
          description: "remove deletes the target. trim_before drops everything earlier. trim_after drops everything later.",
        },
        use: {
          type: "string",
          enum: ["auto", "quote", "sentence", "timestamps", "playback", "selection", "last_target"],
        },
        quote: { type: "string", description: "Words the creator quoted." },
        sentence_id: { type: "string" },
        start_ms: { type: "integer", description: "Source milliseconds." },
        end_ms: { type: "integer", description: "Source milliseconds." },
        sentence_offset: { type: "integer", description: "-1 previous sentence, 1 next sentence." },
        apply: {
          type: "boolean",
          description: "Defaults to true. Set false only to preview without changing the edit.",
        },
      },
      required: ["action"],
    },
  },
  {
    type: "function",
    name: "propose_pause_shortening",
    description:
      "Shorten long silences, keep a little more of them, or protect the pause before a sentence. Applies when the request is unique.",
    parameters: {
      type: "object",
      properties: {
        enable: { type: "boolean", description: "False turns pause shortening off." },
        threshold_ms: { type: "integer", description: "Shorten pauses at least this long. 800 is a good start." },
        retain_ms: { type: "integer", description: "Silence to leave in each shortened pause." },
        delta_retain_ms: { type: "integer", description: "Add this many milliseconds to the retained silence. Use 200 for a little more." },
        protect_pause: { type: "boolean", description: "Keep the full pause before the targeted sentence." },
        clear_protections: { type: "boolean" },
        quote: { type: "string" },
        sentence_id: { type: "string" },
        sentence_offset: { type: "integer" },
        use: { type: "string", enum: ["auto", "quote", "sentence", "playback", "selection", "last_target"] },
        apply: { type: "boolean" },
      },
    },
  },
  {
    type: "function",
    name: "apply_edit",
    description: "Apply a proposal that was returned with status ready. If it is already applied, the tool says so and does not cut again.",
    parameters: {
      type: "object",
      properties: {
        proposal_id: { type: "string", description: "proposal_id from propose_cut or propose_pause_shortening." },
      },
      required: ["proposal_id"],
    },
  },
  {
    type: "function",
    name: "restore_section",
    description:
      "Put one removed sentence back without undoing captions, crop, pauses, or other cuts. Use the sentence ordinal, id, or quote. Second sentence means sentence_ordinal 2.",
    parameters: {
      type: "object",
      properties: {
        sentence_ordinal: { type: "string", description: "1-based number, or first, or last." },
        sentence_id: { type: "string" },
        quote: { type: "string" },
        use: { type: "string", enum: ["auto", "quote", "sentence", "selection", "playback", "last_target"] },
      },
    },
  },
  {
    type: "function",
    name: "correct_previous_section",
    description:
      "Use when the creator says the last cut was the wrong section, such as no I meant the previous section. Restores only that cut and removes the previous sentence instead. Captions, crop, and other cuts stay.",
    parameters: {
      type: "object",
      properties: {
        sentence_offset: { type: "integer", description: "Defaults to -1, the previous sentence." },
      },
    },
  },
  {
    type: "function",
    name: "reorder_sections",
    description:
      "Move a sentence before or after another sentence, or to the start or end. Put the final sentence at the beginning uses moving_ordinal last and place start. Move the explanation before the example uses moving_quote, place before, and anchor_quote.",
    parameters: {
      type: "object",
      properties: {
        moving_ordinal: { type: "string", description: "1-based sentence number, first, or last." },
        moving_sentence_id: { type: "string" },
        moving_quote: { type: "string" },
        moving_use: { type: "string", enum: ["auto", "quote", "sentence", "selection", "playback"] },
        place: { type: "string", enum: ["start", "end", "before", "after"] },
        anchor_ordinal: { type: "string" },
        anchor_sentence_id: { type: "string" },
        anchor_quote: { type: "string" },
      },
      required: ["place"],
    },
  },
  {
    type: "function",
    name: "suggest_shorter_cut",
    description: "Create a transcript-timed shorter-cut proposal without changing the edit. Return the exact proposed sequence and calculated duration for preview and approval.",
    parameters: {
      type: "object",
      properties: {
        target_seconds: { type: "number" },
        focus: { type: "string", description: "Requested editorial focus, such as main announcement or example." },
        keep_sentence_ids: { type: "array", items: { type: "string" } },
        keep_first_question: { type: "boolean" },
      },
    },
  },
  {
    type: "function",
    name: "revise_shorter_cut",
    description: "Revise a pending shorter-cut proposal without changing the live edit.",
    parameters: {
      type: "object",
      properties: {
        proposal_id: { type: "string" },
        keep_sentence_id: { type: "string" },
        keep_sentence_ordinal: { type: "string" },
        keep_first_question: { type: "boolean" },
        before_sentence_id: { type: "string" },
      },
      required: ["proposal_id"],
    },
  },
  {
    type: "function",
    name: "apply_instruction_batch",
    description:
      "Apply several edits from one spoken request, in the order the creator said them. Each instruction is a tool name plus its arguments. Stop at the first failure. The result lists what finished. A retried call does not run finished steps again. Put export_video last.",
    parameters: {
      type: "object",
      properties: {
        instructions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              arguments: { type: "object" },
            },
            required: ["tool", "arguments"],
          },
        },
      },
      required: ["instructions"],
    },
  },
  {
    type: "function",
    name: "undo_edit",
    description: "Undo the last applied edit.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "redo_edit",
    description: "Redo the last undone edit.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "set_caption_style",
    description: "Turn captions on or off and set their size and position. Applies immediately.",
    parameters: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        font_scale: { type: "number", description: "1 is the default. Range 0.7 to 1.8." },
        delta_font_scale: { type: "number", description: "Use 0.2 for bigger and -0.2 for smaller." },
        preset: { type: "string", enum: ["clean", "bold", "minimal"] },
        font_family: { type: "string", enum: ["Arial", "Liberation Sans", "DejaVu Sans"] },
        position: { type: "string", enum: ["bottom", "center", "top"] },
        position_y: { type: "number" },
        delta_position_y: { type: "number", description: "Negative moves captions higher; use -0.12 for higher." },
        color: { type: "string", description: "Hex color such as #F4F1EA." },
        highlight_color: { type: "string" },
        word_highlight: { type: "boolean" },
      },
      required: ["enabled"],
    },
  },
  {
    type: "function",
    name: "set_aspect_ratio",
    description: "Switch between the original frame and a 9:16 cover crop, and slide that crop left or right. Applies immediately.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["original", "wide", "square", "vertical"] },
        focus: { type: "number", description: "0 is the left edge, 0.5 the center, 1 the right edge." },
        focus_y: { type: "number", description: "0 is top, 0.5 center, 1 bottom." },
        nudge: { type: "string", enum: ["left", "right", "center"] },
      },
    },
  },
  {
    type: "function",
    name: "set_audio_mix",
    description: "Adjust original speech volume and optional background music volume, ducking and fades.",
    parameters: {
      type: "object",
      properties: {
        speech_volume: { type: "number" },
        music_volume: { type: "number" },
        duck_music: { type: "boolean" },
        fade_ms: { type: "integer" },
      },
    },
  },
  {
    type: "function",
    name: "preview_segment",
    description: "Move the playhead to a section so the creator can see it. Does not cut.",
    parameters: {
      type: "object",
      properties: {
        quote: { type: "string" },
        sentence_id: { type: "string" },
        use: { type: "string", enum: ["auto", "quote", "sentence", "playback", "selection", "last_target"] },
        sentence_offset: { type: "integer" },
      },
    },
  },
  {
    type: "function",
    name: "export_video",
    description: "Render a downloadable video of the current edit. format is mp4 or webm. quality is 1080p or 720p. Wait for the tool result before saying the file is ready.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["mp4", "webm"] },
        quality: { type: "string", enum: ["1080p", "720p"] },
      },
    },
    execution_mode: "hold",
    timeout_seconds: 180,
  },
] as const;

export function buildSystemPrompt(project: PresentedProject | null): string {
  const lines = [
    "You are Cutback, a video editor speaking with a creator who is watching an edited sequence of one or more short clips.",
    "Talk in one or two short sentences. Lead with the result. No exclamation marks and no preamble.",
    "Never say an edit is done unless the latest tool result has status applied. A partial result is not full success.",
    "Never say the file is ready unless export_video returned status applied or completed.",
    "When the creator asks for more than one change in one breath, call apply_instruction_batch once. Put the steps in the spoken order. Do not also call those tools separately.",
    "If the batch status is partial, say which steps finished and why the next one stopped. Do not retry the finished steps.",
    "If a tool returns needs_clarification, name the candidates in a few words and ask which one. Do not call apply_edit.",
    "If a tool returns error stale_revision, call read_project_context and propose the edit once more.",
    "If a tool returns duplicate or already applied, say it was already done. Do not describe a second cut.",
    "Use source sentence ids and quotes. Do not invent timestamps.",
    "The timeline holds one or more clips laid end to end, and all times are positions on that combined timeline. Say the first, second, or last clip when the creator means a position in the sequence.",
    "Captured playback context is the playhead from the moment the creator started speaking. Trust it over a later moment.",
    "Start where I say a phrase means propose_cut action trim_before with that quote.",
    "End after a phrase, or stop at a phrase, means action trim_after.",
    "Remove that bit, cut this, or delete that means action remove. auto targeting uses selected words, otherwise the captured playhead.",
    "No, I meant the previous section, or the previous sentence, means correct_previous_section. Do not use undo_edit for that, because undo would also remove later unrelated edits.",
    "Restore the second sentence means restore_section with sentence_ordinal 2. Restore the last sentence means sentence_ordinal last.",
    "Keep that pause means propose_pause_shortening with protect_pause true and use playback.",
    "Remove the long pauses means propose_pause_shortening with threshold_ms 800 and retain_ms 180.",
    "Keep a little more silence means propose_pause_shortening with delta_retain_ms 200.",
    "Keep the pause before a sentence means propose_pause_shortening with protect_pause true and that sentence as the target.",
    "Move one quoted section before another means reorder_sections with moving_quote, place before, and anchor_quote.",
    "Put the final sentence at the beginning means reorder_sections with moving_ordinal last and place start.",
    "Requests for a shorter version call suggest_shorter_cut. Report the calculated sequence and duration and ask for approval; never apply it immediately.",
    "Yes, but keep my first question before that means revise_shorter_cut on the pending proposal with keep_first_question true.",
    "Approval of a shorter-cut proposal means apply_edit with its proposal_id.",
    "Make captions bigger means set_caption_style with enabled true and delta_font_scale 0.2.",
    "Highlight the current word in yellow means set_caption_style with enabled true, word_highlight true, and highlight_color #FFD84D.",
    "Move captions higher means set_caption_style with enabled true and delta_position_y -0.12.",
    "When propose_cut or propose_pause_shortening returns status applied, stop. Do not call apply_edit.",
    "Call apply_edit only when a proposal returns status ready.",
    "Undo and redo use undo_edit and redo_edit.",
    "Captions, vertical crop, and export use their own tools.",
  ];
  if (!project?.transcript) {
    lines.push("No transcript is loaded yet. Tell the creator to upload clips and transcribe them. Do not invent cuts.");
    return lines.join(" ");
  }
  const sentences = project.transcript.sentences
    .map((sentence) => `${sentence.id} [${sentence.startMs}-${sentence.endMs}] ${sentence.text}`)
    .join(" | ");
  const clipList = (project.clips ?? [])
    .map((clip, index) => `${index + 1}. ${clip.media.filename} [${clip.offsetMs}-${clip.offsetMs + clip.media.durationMs}]${clip.transcript ? "" : " (no transcript yet)"}`)
    .join(" | ");
  lines.push(
    `${(project.clips ?? []).length} clip(s) on the timeline: ${clipList || "none"}.`,
  );
  lines.push(
    `Revision ${project.revision}. Output duration ${project.outputDurationMs}ms. Framing ${project.edit.framing.mode} focus ${project.edit.framing.focus}. Captions ${project.edit.captions.enabled ? "on" : "off"}. Pause threshold ${project.edit.pause.thresholdMs}ms retain ${project.edit.pause.retainMs}ms.`,
  );
  if (project.playback) {
    lines.push(
      `Captured playhead source ${Math.round(project.playback.sourceTimeMs)}ms. Selected words ${project.playback.selectedWordIds.join(", ") || "none"}.`,
    );
  }
  if (project.lastTarget) {
    lines.push(`Last target ${project.lastTarget.sentenceId ?? "range"}: ${project.lastTarget.label}.`);
  }
  lines.push(`Sentences: ${sentences}`);
  return lines.join(" ");
}

export function voiceSessionUpdate(prompt: string): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      system_prompt: prompt,
      greeting: "Ready. Tell me what to change.",
      tools: VOICE_TOOLS,
      input: {
        format: { encoding: "audio/pcm" },
        transcription_mode: "balanced",
        transcription_prompt:
          "Video editing commands. Expect cut, undo, redo, captions, vertical, pause, sentence, and quoted lines from the video.",
        keyterms: ["Cutback", "captions", "vertical", "undo", "pause", "sentence"],
        language_codes: ["en"],
        voice_focus: "near-field",
        voice_focus_threshold: 0.55,
        turn_detection: {
          vad_threshold: 0.5,
          min_silence: 700,
          max_silence: 2400,
          interrupt_response: true,
          interruption_delay: 120,
        },
      },
      output: {
        voice: "eve",
        format: { encoding: "audio/pcm" },
        volume: 80,
      },
    },
  };
}
