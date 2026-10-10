# Release model catalog

`models.json` owns the catalog. `models.lock.json` maps each catalog ID to the immutable Hugging
Face commit for its target package and, when separately packaged speculative decoding is declared,
the immutable commit for its draft package.

Input modality is inspected from the exact target package. Image-capable targets receive a
projector during generation: a sole repository `mmproj` is selected automatically, while
repositories with multiple candidates require an exact `projector.path` declaration. The
projector is locked as a related component of the target package.

A catalog entry declares no context length. Its serving profile is the target's supported maximum
context from its GGUF metadata, which is the context the engine resolves, serves and assesses.

Swift 1.5 Qwen3.8 27B is available as `swift-1.5-qwen3.8-27b:gguf:q6`. Its
`Q6_K.gguf` format selector distinguishes Q6_K from the repository's Q6_K_L and Q6_K_S
files without changing catalog resolution. The entry uses Swift's projector and the same
locked DFlash2 draft as Qwen3.8 27B. Context and capabilities come from the Swift GGUF.
Its intelligence score is an explicitly documented base-model estimate, not a measured Swift result.

Qwen recurrent-layer flags may cover the decoder alone or include its single MTP block.
Only decoder entries determine the decoder's recurrent and attention layers.

With the fork's server running:

```sh
magnitude catalog pull swift-1.5-qwen3.8-27b:gguf:q6
magnitude models status swift-1.5-qwen3.8-27b:gguf:q6
magnitude models load swift-1.5-qwen3.8-27b:gguf:q6
magnitude models stop
```

```sh
cargo run --release -p magnitude-service-catalog-tool -- update-lock ...   # advance the commit map
cargo run --release -p magnitude-service-catalog-tool -- build-bundle ...  # build the header bundle
```

Generation resolves the pinned repositories and writes `model-planner-inputs.bundle`: the exact GGUF
header (every byte through the aligned tensor-data offset) of every package component, which is
what the engine's header-only planning and chat-template inspection read before a model is
downloaded. Repeated references to the same immutable package share one package identity and one
set of bundled headers. The bundle is derived release output and is not committed. It is the only
catalog-related file shipped alongside the service; catalog definitions and pins are compiled into
the executable.
