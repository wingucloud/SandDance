// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import { FluentUIComponents } from '@msrvida/fluentui-react-cdn-typings';
import { SandDance } from '@msrvida/sanddance-react';

/**
 * References to dependency libraries.
 */
export interface Base {
  fluentUI: FluentUIComponents;
}

export const base: Base = {
    fluentUI: null
};

/**
 * Specify the dependency libraries to use for rendering.
 * @param fluentUI FluentUI React library.
 * @param vega Vega library.
 * @param deck @deck.gl/core library.
 * @param layers @deck.gl/layers library.
 * @param luma @luma.gl/core library.
 */
export function use(
    fluentUI: FluentUIComponents,
    vega: SandDance.VegaDeckGl.types.VegaBase,
    deck: SandDance.VegaDeckGl.types.DeckBase,
    layers: SandDance.VegaDeckGl.types.DeckLayerBase,
    luma: SandDance.VegaDeckGl.types.LumaBase
) {
    SandDance.VegaDeckGl.use(vega, deck, layers, luma);
    base.fluentUI = fluentUI;
}
