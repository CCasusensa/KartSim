# XYY chapter artwork

The native story archive has no chapter-selection card for `xyy_1`. This package
supplies complete Chinese, English and Korean cards, each with normal, hover,
pressed and disabled states at 272×134 pixels.

`reference/` preserves the original story characters, grassland background and
chapter-card layout used as imagegen references. `source/` contains the three
reviewed generated atlases; `prompts.json` records their complete prompts.
`generation.json` records the source archive paths and inspected crop rectangles.
Only atlas slicing, resizing and whole-image disabled-state grayscale conversion
are performed by the build script; it never paints or covers lettering.

From `client/`, rebuild the twelve output PNGs and independent specification with:

```sh
node tools/slice-story-xyy-locale-art.mjs
```

ImageMagick is required. All inputs are stored in this directory; no temporary or
imagegen output-directory paths are needed. The common localized-UI pack builder
automatically includes `spec.json`. Runtime chapter selection discovers the
complete `xyy_11.png`–`xyy_14.png` family in `locale_ui/<locale>/` for all three
languages, including Chinese; it does not use a text fallback for this chapter.
