import StyleDictionary from "style-dictionary"
import _ from "lodash"

const generatedComment = `/* !!! DO NOT EDIT !!! */
/* This file has been generated by the token pipeline */
/* Generated on ${new Date().toUTCString()} */
`

StyleDictionary.registerFilter({
	name: "isGlobalColor",
	matcher: prop =>
	{
		const rootName = prop.path[0]
		return rootName === "Global" && new Set(prop.path).has("Color")
	},
})

StyleDictionary.registerFilter({
	name: "isAliasColor",
	matcher: prop =>
	{
		const rootName = prop.path[0]
		return rootName === "Set" && new Set(prop.path).has("Color")
	},
})

// These are hacks - can we update the input JSON structure to match the expected output?
StyleDictionary.registerTransform({
	name: "fluentui/react/aliasCssVariable",
	type: "value",
	matcher: prop => "resolvedAliasPath" in prop,
	transformer: prop =>
	{
		const aliasPath = prop.resolvedAliasPath.map(_.camelCase)

		// var(--global-color-grey-94) -> var(--global-palette-grey-94)
		//              ^^^^^                          ^^^^^^^
		if (aliasPath.length === 4
			&& aliasPath[0] === "global"
			&& aliasPath[1] === "color"
		)
		{
			return `var(--global-palette-${aliasPath[2]}-${aliasPath[3]})`
		}

		return `var(--${aliasPath.join("-")})`
	},
})

StyleDictionary.registerTransform({
	name: "fluentui/react/highContrastColors",
	type: "value",
	matcher: prop => prop.attributes.category === "color",
	transformer: prop =>
	{
		if (typeof prop.value !== "string") return

		// High contrast colors aren't supported for this output, so convert to the expected hard-coded values.
		switch (prop.value.toLowerCase())
		{
			case "canvas": return "#000000"
			case "canvastext": return "#ffffff"
			case "linktext": return "#ffff00"
			case "graytext": return "#3ff23f"
			case "highlight": return "#1aebff"
			case "highlighttext": return "#000000"
			case "buttonface": return "#ffffff"
			case "buttontext": return "#000000"
		}
		return prop.value
	},
})

StyleDictionary.registerTransform({
	name: "fluentui/react/globalColorName",
	type: "name",
	matcher: prop => (
		prop.path[0] === "Global"
	),
	transformer: prop =>
	{
		return prop.path.slice(2).map(_.camelCase).join(".")
	},
})

StyleDictionary.registerTransform({
	name: "fluentui/react/aliasColorName",
	type: "name",
	matcher: prop => (
		prop.path[0] === "Set"
	),
	transformer: prop =>
	{
		let suffix = prop.path[prop.path.length - 1]
		if (suffix === "Rest")
		{
			suffix = ""
		}
		return `${_.camelCase(prop.path[1])}.${_.camelCase(prop.path[2])}${suffix}`
	},
})

StyleDictionary.registerTransformGroup({
	name: "fluentui/react",
	transforms: [
		"fluentui/attribute",
		"fluentui/name/kebab",
		"fluentui/react/highContrastColors",
		"fluentui/react/aliasCssVariable",
		"fluentui/react/globalColorName",
		"fluentui/react/aliasColorName",
	],
})

const globalColorTypes = {
	"grey": "Record<Greys, string>",
	"whiteAlpha": "Record<AlphaColors, string>",
	"blackAlpha": "Record<AlphaColors, string>",
	"grey14Alpha": "Record<AlphaColors, string>",
}

StyleDictionary.registerFormat({
	name: "react/colors/global",
	formatter: (dictionary, config) =>
	{
		const colors: any = {}
		dictionary.allProperties.forEach(prop =>
		{
			_.setWith(colors, prop.name, prop.value, Object)
		})

		// No brand
		delete colors.brand

		return [
			generatedComment,
			"import type { ColorVariants, Greys, AlphaColors } from '../types';",
			"",
			...Object.keys(colors).map(colorName =>
			{
				if (colors[colorName].shade50 && !colors[colorName].shade60)
				{
					return `export const ${colorName}: ColorVariants = ${JSON.stringify(colors[colorName], null, 2)}`
				}
				const type = globalColorTypes[colorName] ? `: ${globalColorTypes[colorName]}` : ""
				return `export const ${colorName}${type} = ${JSON.stringify(colors[colorName], null, 2)}`
			}),
		].join("\n\n")
	},
})

const firstCharToLowerCase = (input: string): string =>
{
	return input[0].toLowerCase() + input.slice(1)
}

const firstCharToUpperCase = (input: string): string =>
{
	return input[0].toUpperCase() + input.slice(1)
}

const aliasPathToGlobalImport = (resolvedAliasPath: string[], imports: Set<string>): string =>
{
	if (resolvedAliasPath.length < 3 || resolvedAliasPath[0] !== "Global" || resolvedAliasPath[1] !== "Color")
	{
		throw new Error(`Unexpected resolved alias path ${resolvedAliasPath.join(".")}`)
	}

	const exportName = firstCharToLowerCase(resolvedAliasPath[2])

	// grey[14]
	if (resolvedAliasPath.length === 4)
	{
		imports.add(exportName)
		return `${exportName}[${resolvedAliasPath[3]}]`
	}

	if (resolvedAliasPath.length !== 3)
	{
		throw new Error(`Unexpected resolved color alias path ${resolvedAliasPath.join(".")}`)
	}

	imports.add(exportName)
	return exportName
}

StyleDictionary.registerFormat({
	name: "react/colors/alias",
	formatter: (dictionary, config) =>
	{
		const colors: any = { neutral: {} }
		dictionary.allProperties.forEach(prop =>
		{
			_.setWith(colors, prop.name, prop, Object)
		})

		const imports = new Set<string>()

		const colorTokens = Object.keys(colors.neutral).map(colorName =>
		{
			const prop = colors.neutral[colorName]
			const value = prop.resolvedAliasPath
				? aliasPathToGlobalImport(prop.resolvedAliasPath, imports)
				: `'${prop.value}'`

			return `\tcolor${firstCharToUpperCase(colorName)}: ${value}, // ${prop.original.value} ${
				prop.resolvedAliasPath && prop.resolvedAliasPath.join(".")
			}`
		})

		const themeUsesBrand = imports.has("brand")

		return [
			generatedComment,
			`import { ${Array.from(imports).filter(i => i !== "brand").sort().join(", ")} } from '../global/colors';`,
			`import type { ${themeUsesBrand ? "BrandVariants, " : ""}ColorTokens } from '../types';`,
			"",
			`export const generateColorTokens = (${themeUsesBrand ? "brand: BrandVariants" : ""}): ColorTokens => ({`,
			...colorTokens,
			"});",
		].join("\n")
	},
})
