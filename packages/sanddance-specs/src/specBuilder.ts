// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license.
import { addGlobalAxes, AxesScopeMap } from './axes';
import { addColor } from './color';
import { FieldNames, ScaleNames, SignalNames } from './constants';
import {
    axesOffsetX,
    axesOffsetY,
    axesTitlePaddingFacetX,
    axesTitlePaddingFacetY,
    axesTitlePaddingX,
    axesTitlePaddingY,
    defaultBins,
    maxbins
} from './defaults';
import { minFacetHeight, minFacetWidth } from './defaults';
import { FacetLayout, getFacetLayout } from './facetLayout';
import { addFacetAxesGroupMarks } from './facetTitle';
import { fill, opacity } from './fill';
import {
    AxisScales,
    DiscreteColumn,
    EncodingRule,
    GlobalScales,
    GlobalScope,
    Grouping,
    InnerScope,
    Offset2,
    OffsetProp,
    SpecResult
} from './interfaces';
import { LayoutBuildProps, LayoutPair, LayoutProps } from './layouts/layout';
import {
    addData,
    addScale,
    addSignal,
    getDataByName,
    getGroupBy
} from './scope';
import { textSignals } from './signals';
import { SpecCapabilities, SpecContext } from './types';
import {
    ExtentTransform,
    FormulaTransform,
    GroupMark,
    NewSignal,
    Scope,
    Spec
} from 'vega-typings';

export interface SpecBuilderProps {
    axisScales?: AxisScales;
    layouts: LayoutPair[];
    errors?: string[];
    specCapabilities: SpecCapabilities;
    customZScale?: boolean;
}

interface OutField {
    field: string;
    signals: string[];
}

interface OutFieldMap {
    x: OutField;
    y: OutField;
    h: OutField;
    w: OutField;
}

export class SpecBuilder {
    private minCellWidth: NewSignal;
    private minCellHeight: NewSignal;
    private plotOffsetLeft: NewSignal;
    private plotOffsetTop: NewSignal;
    private plotOffsetBottom: NewSignal;
    private plotOffsetRight: NewSignal;
    private plotHeightOut: NewSignal;
    private plotWidthOut: NewSignal;

    constructor(public props: SpecBuilderProps & { specContext: SpecContext }) {
        this.minCellWidth = {
            name: SignalNames.MinCellWidth,
            update: `${minFacetWidth}`
        };
        this.minCellHeight = { name: SignalNames.MinCellHeight, update: `${minFacetHeight}` };
        this.plotOffsetLeft = { name: SignalNames.PlotOffsetLeft, update: '0' };
        this.plotOffsetTop = { name: SignalNames.PlotOffsetTop, update: '0' };
        this.plotOffsetBottom = { name: SignalNames.PlotOffsetBottom, update: '0' };
        this.plotOffsetRight = { name: SignalNames.PlotOffsetRight, update: '0' };
        this.plotHeightOut = { name: SignalNames.PlotHeightOut, update: SignalNames.PlotHeightIn };
        this.plotWidthOut = { name: SignalNames.PlotWidthOut, update: SignalNames.PlotWidthIn };
    }

    public validate() {
        const { specCapabilities, specContext } = this.props;
        const { roles } = specCapabilities;
        const required = roles.filter(r => !r.allowNone);
        const numeric = roles.filter(r => r.excludeCategoric);
        const errors = required
            .map(
                r => {
                    if (specContext.specColumns[r.role]) {
                        return null;
                    } else {
                        return `Field ${r.role} is required.`;
                    }
                }
            )
            .concat(
                numeric.map(
                    r => {
                        if (specContext.specColumns[r.role] && !specContext.specColumns[r.role].quantitative) {
                            return `Field ${r.role} must be quantitative.`;
                        } else {
                            return null;
                        }
                    }
                )
            )
            .filter(Boolean);
        return errors;
    }

    public build(): SpecResult {
        const { specCapabilities } = this.props;
        const errors = this.validate();
        if (errors.length) {
            return {
                errors,
                specCapabilities,
                vegaSpec: null
            };
        } else {
            const { specContext } = this.props;
            const { insight, specColumns, specViewOptions } = specContext;
            const dataName = 'data_source';
            const { vegaSpec, groupMark } = this.initSpec(dataName);
            const { topColorField, colorDataName } = addColor({
                scope: vegaSpec,
                dataName,
                specContext,
                scaleName: ScaleNames.Color,
                legendDataName: 'data_legend',
                topLookupName: 'data_topcolorlookup',
                colorReverseSignalName: SignalNames.ColorReverse
            });
            const globalScope = this.createGlobalScope(colorDataName, vegaSpec, groupMark);
            let facetLayout: FacetLayout;
            if (insight.columns.facet) {
                const discreteFacetColumn: DiscreteColumn = {
                    column: specColumns.facet,
                    defaultBins,
                    maxbins,
                    maxbinsSignalDisplayName: specViewOptions.language.FacetMaxBins,
                    maxbinsSignalName: SignalNames.FacetBins
                };
                const discreteFacetVColumn: DiscreteColumn = {
                    column: specColumns.facetV,
                    defaultBins,
                    maxbins,
                    maxbinsSignalDisplayName: specViewOptions.language.FacetVMaxBins,
                    maxbinsSignalName: SignalNames.FacetVBins
                };
                facetLayout = getFacetLayout(insight.facetStyle, discreteFacetColumn, discreteFacetVColumn, specViewOptions.colors.axisText);
                addSignal(vegaSpec, ...facetLayout.signals);
                addScale(vegaSpec, ...facetLayout.scales);
                this.props.layouts = [facetLayout.layoutPair, ...this.props.layouts];
                this.plotOffsetTop.update = `${facetLayout.plotPadding.y}`;
                this.plotOffsetRight.update = `${facetLayout.plotPadding.x}`;
            }
            const {
                firstScope,
                finalScope,
                specResult,
                allGlobalScales,
                allEncodingRules,
                groupings,
                sums,
                offsets
            } = this.iterateLayouts(globalScope, groupMark, colorDataName);

            if (specResult) {
                return specResult;
            }
            if (allGlobalScales.length > 0) {
                let axesScopes: AxesScopeMap = facetLayout ?
                    addFacetAxesGroupMarks({
                        globalScope: globalScope.scope,
                        plotScope: groupMark,
                        facetScope: firstScope,
                        plotHeightOut: this.plotHeightOut.name,
                        plotWidthOut: this.plotWidthOut.name,
                        colTitleScaleName: 'scale_facet_col_title',
                        rowTitleScaleName: 'scale_facet_row_title',
                        colSeqName: 'data_FacetCellColTitles',
                        rowSeqName: 'data_FacetCellRowTitles'
                    })
                    :
                    {
                        main: [{
                            scope: groupMark,
                            lines: true,
                            labels: true,
                            title: true
                        }]
                    };
                addGlobalAxes({
                    globalScope,
                    allGlobalScales,
                    axisScales: this.props.axisScales,
                    plotOffsetSignals: { x: this.plotOffsetLeft, y: this.plotOffsetBottom },
                    axesOffsets: { x: axesOffsetX, y: axesOffsetY },
                    axesTitlePadding: facetLayout ? { x: axesTitlePaddingFacetX, y: axesTitlePaddingFacetY } : { x: axesTitlePaddingX, y: axesTitlePaddingY },
                    labelBaseline: { x: 'top', y: 'middle' },
                    specColumns,
                    specViewOptions,
                    axesScopes
                });
            }

            //this.insertDataGroupings(colorDataName, groupings, globalScope, sums);

            if (offsets.length) {
                const formulas: FormulaTransform[] = [];

                const outfields: OutFieldMap = {
                    x: { field: FieldNames.OffsetX, signals: [] },
                    y: { field: FieldNames.OffsetY, signals: [] },
                    h: { field: FieldNames.OffsetHeight, signals: [] },
                    w: { field: FieldNames.OffsetWidth, signals: [] }
                };

                function add(of: OutField, prop: OffsetProp) {
                    if (!prop || prop.passThrough) return;
                    if (prop.formula) {
                        of.signals.push(`datum[${JSON.stringify(prop.formula.as)}]` as string);
                    } else {
                        if (prop.signal !== '0') {
                            of.signals.push(prop.signal);
                        }
                    }
                }

                offsets.forEach(offset => {
                    for (let key in offset) {
                        let prop = offset[key] as OffsetProp;
                        if (!prop || prop.passThrough) continue;
                        if (prop.formula) {
                            formulas.push(prop.formula);
                        }
                    }
                    add(outfields.x, offset.x);
                    add(outfields.y, offset.y);
                    add(outfields.h, offset.h);
                    add(outfields.w, offset.w);
                });

                const arr = [outfields.x, outfields.y];

                addData(globalScope.scope, {
                    name: 'TODObigtable',
                    source: finalScope.markData || colorDataName,
                    transform: [
                        ...formulas,
                        ...arr.map(a => {
                            if (!a.signals.length) return;
                            const t: FormulaTransform = {
                                type: 'formula',
                                expr: a.signals.join(' + '),
                                as: a.field
                            };
                            return t;
                        }).filter(Boolean)
                    ]
                });
            }

            //add mark to the final scope
            if (finalScope.mark) {
                const { update } = finalScope.mark.encode;

                if (offsets.length) {   //TODO mandatory
                    update.x = {
                        field: FieldNames.OffsetX
                    };
                    update.y = {
                        field: FieldNames.OffsetY
                    };
                }

                allEncodingRules.forEach(map => {
                    for (let key in map) {
                        if (update[key]) {
                            let arrIn = map[key];
                            if (!Array.isArray(update[key])) {
                                let value = update[key];
                                let arrOut = [];
                                update[key] = arrOut;
                                arrIn.forEach(rule => arrOut.push(rule));
                                arrOut.push(value);
                            } else {
                                let arrOut = update[key] as {}[];
                                arrIn.forEach(rule => arrOut.unshift(rule));
                            }
                        }
                    }
                });

                update.fill = fill(specContext, topColorField, ScaleNames.Color);
                update.opacity = opacity(specContext);
            }
            return {
                specCapabilities,
                vegaSpec
            };
        }
    }

    private insertDataGroupings(dataName: string, groupings: Grouping[], globalScope: GlobalScope, sums: boolean) {
        const sourceData = getDataByName(globalScope.scope.data, dataName);
        let source = dataName;
        const data = [sourceData.data];


        for (let i = 0; i < groupings.length - 1; i++) {//don't apply to last element
            let grouping = groupings[i];
            grouping.fieldOps.push({ field: FieldNames.Count, op: 'sum', as: FieldNames.SumOfCount });
            if (sums) {
                grouping.fieldOps.push({ field: FieldNames.Sum, op: 'sum', as: FieldNames.SumOfSum });
            }
        }

        for (let i = 0; i < groupings.length - 2; i++) {//don't apply to 2nd to last element
            let grouping = groupings[i];
            grouping.fieldOps[grouping.fieldOps.length - 1].field = FieldNames.SumOfCount;
            if (sums) {
                grouping.fieldOps[grouping.fieldOps.length - 1].field = FieldNames.SumOfSum;
            }
        }

        for (let i = groupings.length; i--;) {
            let grouping = groupings[i];
            let groupDataName = `group_${grouping.id}`;
            data.push({
                name: groupDataName,
                source,
                transform: [
                    {
                        type: 'aggregate',
                        groupby: getGroupBy(groupings.slice(0, i + 1)),
                        ops: grouping.fieldOps.map(fo => fo.op),
                        fields: grouping.fieldOps.map(fo => fo.field),
                        as: grouping.fieldOps.map(fo => fo.as)
                    },
                    ...grouping.fieldOps.map(fo => {
                        const t: ExtentTransform = {
                            type: 'extent',
                            field: fo.as,
                            signal: `group_${grouping.id}_${fo.op}_extent`
                        };
                        return t;
                    })
                ]
            });
            source = groupDataName;
        }
        globalScope.scope.data.splice(sourceData.index, 1, ...data);
    }

    private createGlobalScope(dataName: string, scope: Spec, markGroup: Scope) {
        const { minCellWidth, minCellHeight, plotHeightOut, plotWidthOut } = this;
        const globalScope: GlobalScope = {
            prefix: '',
            dataName,
            scope,
            markGroup,
            offsets: {
                x: { signal: '0' },
                y: { signal: '0' },
                h: { signal: SignalNames.PlotHeightIn },
                w: { signal: SignalNames.PlotWidthIn }
            },
            sizeSignals: {
                layoutHeight: SignalNames.PlotHeightIn,
                layoutWidth: SignalNames.PlotWidthIn
            },
            signals: {
                minCellWidth,
                minCellHeight,
                plotHeightOut,
                plotWidthOut
            }
        };
        return globalScope;
    }

    private initSpec(dataName: string) {
        const { minCellWidth, minCellHeight, plotOffsetLeft, plotOffsetBottom, plotOffsetTop, plotOffsetRight, plotHeightOut, plotWidthOut } = this;
        const { specContext } = this.props;
        const { insight } = specContext;
        const groupMark: GroupMark = {
            type: 'group',
            //style: 'cell',
            encode: {
                update: {
                    x: { signal: SignalNames.PlotOffsetLeft },
                    y: { signal: SignalNames.PlotOffsetTop },
                    height: { signal: SignalNames.PlotHeightOut },
                    width: { signal: SignalNames.PlotWidthOut }
                }
            }
        };
        const source = 'origin';
        const vegaSpec: Spec = {
            $schema: 'https://vega.github.io/schema/vega/v5.json',
            //style: 'cell',
            data: [{ name: source }, { name: dataName, source, transform: [] }],
            marks: [groupMark],
            signals: textSignals(specContext, SignalNames.ViewportHeight).concat([
                minCellWidth,
                minCellHeight,
                {
                    name: SignalNames.ViewportHeight,
                    update: `max(${SignalNames.MinCellHeight}, ${insight.size.height})`
                },
                {
                    name: SignalNames.ViewportWidth,
                    update: `max(${SignalNames.MinCellWidth}, ${insight.size.width})`
                },
                plotOffsetLeft,
                plotOffsetTop,
                plotOffsetBottom,
                plotOffsetRight,
                {
                    name: SignalNames.PlotHeightIn,
                    update: `${SignalNames.ViewportHeight} - ${SignalNames.PlotOffsetBottom}`
                },
                {
                    name: SignalNames.PlotWidthIn,
                    update: `${SignalNames.ViewportWidth} - ${SignalNames.PlotOffsetLeft} - ${SignalNames.PlotOffsetRight}`
                },
                plotHeightOut,
                plotWidthOut,
                {
                    name: 'height',
                    update: `${SignalNames.PlotOffsetTop} + ${SignalNames.PlotHeightOut} + ${SignalNames.PlotOffsetBottom}`
                },
                {
                    name: 'width',
                    update: `${SignalNames.PlotWidthOut} + ${SignalNames.PlotOffsetLeft} + ${SignalNames.PlotOffsetRight}`
                }
            ])
        };
        return { vegaSpec, groupMark };
    }

    private iterateLayouts(globalScope: GlobalScope, scope: Scope, dataName: string) {
        let specResult: SpecResult;
        let parentScope: InnerScope = {
            prefix: '',
            dataName,
            sizeSignals: globalScope.sizeSignals,
            offsets: globalScope.offsets
        };
        let firstScope: InnerScope;
        let childScope: InnerScope;
        const groupings: Grouping[] = [];
        const offsets: Offset2[] = [];
        let sums = false;
        let { layouts, specCapabilities } = this.props;
        const allGlobalScales: GlobalScales[] = [];
        const allEncodingRules: { [key: string]: EncodingRule[] }[] = [];
        for (let i = 0; i < layouts.length; i++) {
            if (!parentScope) continue;
            let buildProps: LayoutBuildProps = {
                globalScope,
                parentScope,
                axesScales: this.props.axisScales,
                groupings,
                id: i
            };
            let layout = this.createLayout(layouts[i], buildProps);
            try {
                childScope = layout.build();
                childScope.id = i;
                if (childScope.offsets) {
                    offsets.push(childScope.offsets);
                }
                let groupby = layout.getGrouping();
                if (groupby) {
                    groupings.push({
                        id: i,
                        groupby,
                        fieldOps: [
                            { field: null, op: 'count', as: FieldNames.Count }
                        ]
                    });
                }
                let sumOp = layout.getAggregateSumOp();
                if (sumOp) {
                    groupings[groupings.length - 1].fieldOps.push(sumOp);
                    sums = true;
                }
            }
            catch (e) {
                specResult = {
                    errors: [e.stack],
                    specCapabilities,
                    vegaSpec: null
                };
                break;
            }
            if (childScope && childScope.globalScales) {
                allGlobalScales.push(childScope.globalScales);
            }
            if (childScope.encodingRuleMap) {
                allEncodingRules.push(childScope.encodingRuleMap);
            }
            if (i === 0) {
                firstScope = childScope;
            }
            parentScope = childScope;
        }
        return { firstScope, finalScope: parentScope, specResult, allGlobalScales, allEncodingRules, groupings, sums, offsets };
    }

    private createLayout(layoutPair: LayoutPair, buildProps: LayoutBuildProps) {
        const { layoutClass, props } = layoutPair;
        const layoutBuildProps: LayoutProps & LayoutBuildProps = {
            ...props,
            ...buildProps
        };
        const layout = new layoutClass(layoutBuildProps);
        layout.id = buildProps.id;
        return layout;
    }
}
