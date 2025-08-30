# Related Sources

Quickly jump between related source files in your project.

This Visual Studio Code extension finds files related to the currently active editor file using user-configurable matchers and opens the next file in the sorted list (including the current file). It is useful for jumping between header/source pairs, generated artifacts, or other related file sets and is completely configurable.

## Usage

- With a file open and the editor focused, press `F4` to open the next related file.
- Or run the command from the Command Palette: `Related Sources: Next Related File`.

## Details

- Find related files based on configurable regular-expression matchers.
- Includes the current file in the candidate list, sorts the list alphabetically, and opens the next file (wraps to the first).
- Keyboard shortcut: `F4` (when the editor has focus).
- Works with named capture groups and numbered capture groups when substituting into target paths.
- Default matchers setup for chromium source projects.

## Configuration

The extension uses the `relatedsources.matchers` setting (an array) to discover related files. Each matcher is an object with the following properties:

- `sourceRegexp` (string) — a regular expression to match the current file's path (relative to the workspace root). Named capture groups (`(?<name>...)`) or numbered capture groups can be used.
- `targetPath` (string) — a glob-style target pattern. Use `${name}` to substitute named capture groups or `${1}` for numbered groups. The pattern is interpreted relative to the workspace root.
- `name` (string) — a friendly name for the matcher.

Example settings (to add to your workspace or user settings):

```json
"relatedsources.matchers": [
  {
    "sourceRegexp": "^(?<path>.*)\\.[^.]*$",
    "targetPath": "${path}.*",
    "name": "Same filename"
  },
  {
    "sourceRegexp": "^(?<path>.*)\\.[^.]*$",
    "targetPath": "out/*/gen/${path}.*",
    "name": "Generated files"
  },
  {
    "sourceRegexp": "^out/*/gen/(?<path>.*)\\.[^.]*$",
    "targetPath": "${path}.*",
    "name": "Generated files (reverse)"
  }
]
```

The example above:

- `^(?<path>.*)\\.[^.]*$` matches a filename and captures the path (without extension) into the `path` group.
- `${path}.*` finds files that share the same base filename (different extensions, folders, etc.).

## Contributing

Contributions, suggestions and bug reports are welcome. Open an issue on the repository or submit a pull request.

## License

This project is available under the MIT license.

## Privacy

This extension does not collect any personal data or usage statistics. All file paths and workspace information are processed locally and are not sent to any external servers.