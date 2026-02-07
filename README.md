# Offline Spell Checker

## Description

This extension is a spell checker that uses a local dictionary for offline usage. [hunspell-spellchecker](https://github.com/GitbookIO/hunspell-spellchecker) is used to load hunspell formatted dictionaries. Errors are highlighted, and hovering over them will show possible suggestions.

## Functionality

Once errors are highlighted, there are several ways to view word suggestions.

Hover over the error:

![Hover](images/hover-view.png)

By pressing `F8` to step through errors:

![Error View](images/error-view.png)

You can correct the error by clicking on the Quick Fix (light bulb) icon.

![Quick Fix](images/making-corrections.gif)

## Configuration File

You can configure the operation of this extension by editing settings in `File > Preferences > Settings`.

The following settings can be changed:

* `spellchecker.language`: supported languages are:
	* English (`"en_US"`, `"en_GB-ize"`, or `"en_GB-ise"`)
	* French (`"fr"`)
	* Greek (`"el_GR"`)
	* Spanish (`"es_ANY"`)
	* Swedish (`"sv_SE"`)
* `spellchecker.ignoreWordsList`: an array of strings that contain the words that will not be checked by the spell checker
* `spellchecker.documentTypes`: an array of strings that limit the document types that this extension will check. Default document types are `"markdown"`, `"latex"`, and `"plaintext"`.
* `spellchecker.ignoreFileExtensions`: an array of file extensions that will not be spell checked
* `spellchecker.checkInterval`: number of milliseconds to delay between full document spell checks. Default: 5000 ms.
* `spellchecker.ignoreRegExp`: an array of regular expressions that will be used to remove text from the document before it is checked. Since the expressions are represented in the JSON as strings, all backslashes need to be escaped with three additional backslashes, e.g. `/\s/g` becomes `"/\\\\s/g"`. The following are examples provided in the example configuration file:
	* `"/\\\\(.*\\\\.(jpg|jpeg|png|md|gif|JPG|JPEG|PNG|MD|GIF)\\\\)/g"`: remove links to image and markdown files
	* `"/((http|https|ftp|git)\\\\S*)/g"`: remove hyperlinks
	* `"/^(```\\\\s*)(\\\\w+)?(\\\\s*[\\\\w\\\\W]+?\\\\n*)(```\\\\s*)\\\\n*$/gm"`: remove code blocks
* `spellchecker.emitErrors`: Emit errors instead of warnings for spelling mistakes

Additional sections are already removed from files, including:

* YAML header for [pandoc](http://pandoc.org/) settings
* `&nbsp;`
* Pandoc citations
* Inline code blocks
* Email addresses

## Acknowledgements

Big thanks to Sean McBreen for [Spell and Grammar Check](https://github.com/Microsoft/vscode-spell-check).

## License

MIT
