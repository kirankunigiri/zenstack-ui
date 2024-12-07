/* eslint-disable react-hooks/rules-of-hooks */
/* eslint-disable no-useless-assignment */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useForm } from '@mantine/form';
import { getHotkeyHandler } from '@mantine/hooks';
import { zodResolver } from 'mantine-form-zod-resolver';
import { cloneElement, isValidElement, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import React from 'react';
import { z, ZodSchema } from 'zod';

import { Field, FieldType, Metadata, UseFindUniqueHook, UseMutationHook, UseQueryHook } from '../metadata';
import { useZenstackUIProvider } from '../utils/provider';
import { getIdField, getModelFields } from '../utils/utils';

const LOADING_PLACEHOLDER = 'Loading...';

// Form ref type
export interface ZSFormRef {
	form: ReturnType<typeof useForm>
}

export interface ZSFormOverrideProps {
	onSubmit?: (values: any) => void // Do custom action after submission completes
	overrideSubmit?: (values: any) => Promise<void> // Override default submission behavior with custom server hook
	schemaOverride?: ZodSchema
	metadataOverride?: Metadata
	formRef?: React.RefObject<ZSFormRef>
}

interface ZSSharedFormProps extends ZSFormOverrideProps {
	model: string
	children?: React.ReactNode
	className?: string
}

interface ZSUpdateFormProps extends ZSSharedFormProps {
	id: number | string
	/** Called by the form when the id field is updated. Useful for updating the URL */
	onIdChanged?: (id: number | string) => void
}

type ZSCreateFormProps = ZSSharedFormProps;

type ZSFormType = 'create' | 'update';

interface ZSBaseFormProps extends ZSSharedFormProps {
	form: ReturnType<typeof useForm>
	schema: ZodSchema
	type: ZSFormType

	// Loading states
	isLoadingInitialData?: boolean
	isLoadingUpdate?: boolean
	isLoadingCreate?: boolean
}

/** Generates the default state for the form */
const createDefaultValues = (fields: Record<string, Field>, type: ZSFormType) => {
	const defaultValueMap: Record<string, any> = {};
	Object.values(fields).forEach((field) => {
		if (field.isDataModel) return;
		const defaultAttr = field.attributes?.find(attr => attr.name === '@default');
		if (defaultAttr?.args?.[0]?.value) {
			defaultValueMap[field.name] = defaultAttr?.args?.[0]?.value;
		} else {
			// For create forms, we avoid using defaults. This is so autogenerated fields like id's can still work
			if (type === 'create') {
				if (field.type === FieldType.Boolean) defaultValueMap[field.name] = false;
				return;
			}

			// For update forms, we must set primitive defaults to avoid undefined values, which will cause errors with Mantine useForm
			if (field.type === FieldType.Boolean) {
				defaultValueMap[field.name] = false;
			} else if (field.type === FieldType.Int || field.type === FieldType.Float) {
				defaultValueMap[field.name] = 0;
			} else {
				defaultValueMap[field.name] = '';
			}
		}
	});
	return defaultValueMap;
};

/**
 * Cleans and connects data for foreign key fields
 * @param data - Data to clean
 * @param fields - Fields for the model
 * @returns Cleaned data
 * Example: { ownerName: 'John Doe', name: 'Item 1' } -> { owner: { connect: { name: 'John Doe' } }, name: 'Item 1' }
 */
const cleanAndConnectData = (data: Record<string, unknown>, fields: Record<string, Field>) => {
	// Create a clean copy of data
	const cleanData = { ...data };
	const connectorData: Record<string, unknown> = {};

	// Iterate through foreign key fields
	Object.values(fields).forEach((field) => {
		if (!field.isForeignKey) return;
		const relationField = fields[field.relationField!];
		const relationIdKey = Object.keys(relationField.foreignKeyMapping!)[0];
		const relationValue = cleanData[field.name];

		// If value exists, create connect object for the relation
		if (!relationValue) return;
		connectorData[field.relationField!] = {
			connect: {
				[relationIdKey]: relationValue,
			},
		};

		// Remove the foreign key field from clean data
		delete cleanData[field.name];
	});

	return { ...cleanData, ...connectorData };
};

/**
 * Captures currently focused element and returns a function to restore focus to it
 * @returns Function that restores focus to the previously active element
 */
const focusOnPrevActiveElement = () => {
	const activeElement = document.activeElement as HTMLElement;
	const dataPath = activeElement?.getAttribute('data-path');

	return () => {
		setTimeout(() => {
			const elementToFocus = document.querySelector(`[data-path="${dataPath}"]`) as HTMLElement;
			elementToFocus?.focus();
		}, 0);
	};
};

// --------------------------------------------------------------------------------
// Update Form
// --------------------------------------------------------------------------------
export const ZSUpdateForm = (props: ZSUpdateFormProps) => {
	const { hooks, schemas, metadata: originalMetadata, queryClient, globalClassName } = useZenstackUIProvider();
	const metadata = props.metadataOverride || originalMetadata;

	// Extract information
	const mainSchema = props.schemaOverride || schemas[`${props.model}Schema`]; // we don't use update schema because that will mark everything as optional
	const fields = getModelFields(metadata, props.model);
	const idField = getIdField(fields);

	// Fetch initial values
	const useFindUniqueHook = hooks[`useFindUnique${props.model}`] as UseFindUniqueHook<any>;
	const { data, isLoading: isLoadingInitialData } = useFindUniqueHook({ where: { [idField.name]: props.id } });

	// Setup update hook
	const [isLoadingUpdate, setIsLoadingUpdate] = useState(false);
	const useUpdateHook = hooks[`useUpdate${props.model}`] as UseMutationHook<any>;
	const update = useUpdateHook({ optimisticUpdate: true });

	// Setup form
	const form = useForm({
		mode: 'controlled', // Controlled mode is required for adaptive filters
		validate: zodResolver(mainSchema),
		initialValues: createDefaultValues(fields, 'update'),
		// validateInputOnBlur: true,
	});

	// Add useImperativeHandle to expose form object
	useImperativeHandle(props.formRef, () => ({
		form,
	}));

	// When the id changes, reset back to an empty form first before the new query starts
	useEffect(() => {
		const defaultValues = createDefaultValues(fields, 'update');
		form.setInitialValues(defaultValues);
		form.setValues(defaultValues);
		form.resetDirty();
	}, [props.id]);

	// Set initial values after data is fetched
	useEffect(() => {
		if (data) {
			// Get default values, and replace them with the newly fetched data
			const defaultValues = createDefaultValues(fields, 'update');
			for (const key in data) {
				if (data[key] !== undefined && data[key] !== null) defaultValues[key] = data[key];
			}

			form.setInitialValues(defaultValues);
			form.setValues(defaultValues);
			form.resetDirty();
		}
	}, [data]);

	// Handle update submit
	const handleUpdateSubmit = async (x: any) => {
		// We parse the data ourselves so that any zod transformations can be applied (ex: empty strings to nulls)
		const result = mainSchema.safeParse(x);
		if (!result.success) {
			console.error('Update data does not follow the schema:', result.error);
			return;
		}
		const values = result.data;

		setIsLoadingUpdate(true);

		try {
			// Only send dirty fields for the update query
			const dirtyFields = form.getDirty();
			const dirtyValues = Object.fromEntries(
				Object.entries(values as Record<string, unknown>)
					.filter(([key]) => dirtyFields[key])
					.map(([key, value]) => {
						// Convert empty strings to null for optional fields
						if (fields[key]?.isOptional && value === '') return [key, null];
						return [key, value];
					}),
			);
			// Generate update payload
			const cleanedData = cleanAndConnectData(dirtyValues, fields);
			const updatePayload = {
				where: { [idField.name]: props.id },
				data: cleanedData,
			};

			if (props.overrideSubmit) {
				await props.overrideSubmit(updatePayload);
				props.onSubmit?.(updatePayload);
				// Invalidate all queries for this model
				queryClient.invalidateQueries({
					predicate: (query) => {
						const queryKey = query.queryKey;
						return queryKey.includes(props.model);
					},
				});
			} else {
				await update.mutateAsync(updatePayload);
			}

			// Check if ID field was updated and trigger callbacks
			if (dirtyFields[idField.name]) props.onIdChanged?.(values[idField.name]);
			props.onSubmit?.(cleanedData);
		} catch (error) {
			console.error('Update failed:', error);
		} finally {
			setIsLoadingUpdate(false);
		}
	};

	// Reverts form to initial values and focuses on the last edited element
	const handleRevertShortcut = () => {
		const focus = focusOnPrevActiveElement();
		form.reset();
		focus();
	};

	return (
		<form
			className={`${globalClassName || ''} ${props.className || ''}`.trim()}
			onSubmit={form.onSubmit(handleUpdateSubmit)}
			onKeyDown={getHotkeyHandler([
				['meta+s', form.onSubmit(handleUpdateSubmit)],
				['mod+backspace', handleRevertShortcut],
			])}
		>
			<ZSBaseForm model={props.model} form={form} schema={mainSchema} type="update" isLoadingInitialData={isLoadingInitialData} isLoadingUpdate={isLoadingUpdate} metadataOverride={props.metadataOverride}>
				{props.children}
			</ZSBaseForm>
		</form>
	);
};

// --------------------------------------------------------------------------------
// Create Form
// --------------------------------------------------------------------------------
export const ZSCreateForm = (props: ZSCreateFormProps) => {
	const { hooks, schemas, metadata: originalMetadata, queryClient, globalClassName } = useZenstackUIProvider();
	const metadata = props.metadataOverride || originalMetadata;

	// Extract information
	const createSchema: ZodSchema = props.schemaOverride || schemas[`${props.model}CreateSchema`];
	const fields = getModelFields(metadata, props.model);

	// Setup create hook
	const [isLoadingCreate, setIsLoadingCreate] = useState(false);
	const useCreateHook = hooks[`useCreate${props.model}`] as UseMutationHook<any>;
	const create = useCreateHook({ optimisticUpdate: true });

	// Setup form
	const form = useForm({
		mode: 'controlled', // Controlled mode is required for adaptive filters
		validate: zodResolver(createSchema),
		initialValues: createDefaultValues(fields, 'create'),
		// validateInputOnBlur: true,
	});

	// Add useImperativeHandle to expose form object
	useImperativeHandle(props.formRef, () => ({
		form,
	}));

	// Handle create submit
	const handleCreateSubmit = async (x: any) => {
		// We parse the data ourselves so that any zod transformations can be applied (ex: empty strings to nulls)
		const result = createSchema.safeParse(x);
		if (!result.success) {
			console.error('Create data does not follow the schema:', result.error);
			return;
		}
		const values = result.data;

		setIsLoadingCreate(true);
		try {
			const cleanedData = cleanAndConnectData(values, fields);
			const createPayload = { data: cleanedData };

			if (props.overrideSubmit) {
				// For overrideSubmit, we omit the data key to keep it simpler
				await props.overrideSubmit(cleanedData);
				props.onSubmit?.(cleanedData);

				// Invalidate all queries for this model
				queryClient.invalidateQueries({
					predicate: (query) => {
						const queryKey = query.queryKey;
						return queryKey.includes(props.model);
					},
				});
			} else {
				await create.mutateAsync(createPayload);
				props.onSubmit?.(createPayload);
			}
		} catch (error) {
			console.error('Create failed:', error);
		} finally {
			setIsLoadingCreate(false);
		}
	};

	return (
		<form
			className={`${globalClassName || ''} ${props.className || ''}`.trim()}
			onSubmit={form.onSubmit(handleCreateSubmit)}
		>
			<ZSBaseForm model={props.model} form={form} schema={createSchema} type="create" isLoadingCreate={isLoadingCreate} metadataOverride={props.metadataOverride}>
				{props.children}
			</ZSBaseForm>
		</form>
	);
};

// --------------------------------------------------------------------------------
// Base Form (shared between create/update forms)
// --------------------------------------------------------------------------------

const ZSBaseForm = (props: ZSBaseFormProps) => {
	const { metadata: originalMetadata, submitButtons } = useZenstackUIProvider();
	const metadata = props.metadataOverride || originalMetadata;
	const fields = getModelFields(metadata, props.model);

	// Memoize fields object
	const memoizedFields = useMemo(() => fields, [fields]);

	// Memoize the check for custom/placeholder fields
	const hasCustomOrPlaceholder = useCallback((fieldName: string, children: React.ReactNode): boolean => {
		return React.Children.toArray(children).some((child) => {
			if (!isValidElement(child)) return false;

			if (typeof child.type === 'function') {
				const displayName = (child.type as any).displayName;
				if (displayName === ZSCUSTOM_FIELD_DISPLAY_NAME && child.props.fieldName === fieldName) {
					return true;
				}
				if (displayName === ZSFIELDSLOT_DISPLAY_NAME && child.props.fieldName === fieldName) {
					return true;
				}

				try {
					const renderedElement = (child.type as (props: any) => React.ReactNode)(child.props);
					return hasCustomOrPlaceholder(fieldName, renderedElement);
				} catch (error) {
					return false;
				}
			}

			return child.props.children ? hasCustomOrPlaceholder(fieldName, child.props.children) : false;
		});
	}, []);

	// Memoize the processChildren function
	const processChildren = useCallback((element: React.ReactNode): React.ReactNode => {
		if (!isValidElement(element)) return element;

		if (typeof element.type === 'function') {
			const displayName = (element.type as any).displayName;

			if (displayName === ZSCUSTOM_FIELD_DISPLAY_NAME) {
				const fieldName = element.props.fieldName;
				const field = memoizedFields[fieldName];
				const customElement = React.Children.only(element.props.children);

				if (!field) {
					console.warn(`Field ${fieldName} not found in model ${props.model}`);
					return element;
				}

				// Replace customElement with ZSFormInputInternal
				return (
					<ZSFormInputInternal
						key={fieldName}
						field={field}
						index={-1}
						customElement={customElement}
						{...props}
					/>
				);
			}

			if (displayName === ZSFIELDSLOT_DISPLAY_NAME) {
				const fieldName = element.props.fieldName;
				const field = memoizedFields[fieldName];

				if (!field) {
					console.warn(`Field ${fieldName} not found in model ${props.model}`);
					return element;
				}

				// Replace ZSFieldSlot with ZSFormInputInternal
				return (
					<ZSFormInputInternal
						key={fieldName}
						field={field}
						index={-1}
						className={element.props.className}
						onChange={element.props.onChange}
						{...props}
					/>
				);
			}

			try {
				const renderedElement = (element.type as (props: any) => React.ReactNode)(element.props);
				return processChildren(renderedElement);
			} catch (error) {
				return element;
			}
		}

		if (element.props.children) {
			return cloneElement(element, {
				...element.props,
				children: React.Children.map(element.props.children, child => processChildren(child)),
			});
		}

		return element;
	}, [memoizedFields, props]);

	// Memoize error checking
	const hasErrors = useMemo(() => Object.keys(props.form.errors).length > 0, [props.form.errors]);

	// Memoize dirty state for update button
	const isDirty = useMemo(() => {
		return props.type === 'update' && Object.values(props.form.getDirty()).some(isDirty => isDirty);
	}, [props.type, props.form.getDirty()]);

	return (
		<>
			<AutomaticFormFields
				fields={memoizedFields}
				hasCustomOrPlaceholder={hasCustomOrPlaceholder}
				{...props}
			>
				{props.children}
			</AutomaticFormFields>

			<UserDefinedFields processChildren={processChildren}>
				{props.children}
			</UserDefinedFields>

			{hasErrors && (
				<div style={{ flexShrink: 1 }}>
					<p
						style={{
							wordBreak: 'break-word',
							fontSize: '0.75rem',
							color: '#ef4444',
						}}
						title={JSON.stringify(props.form.errors)}
					>
						Errors: {JSON.stringify(props.form.errors)}
					</p>
				</div>
			)}

			{props.type === 'create' && (
				<submitButtons.create
					model={props.model}
					type="submit"
					loading={props.isLoadingCreate}
				/>
			)}
			{props.type === 'update' && (
				<submitButtons.update
					model={props.model}
					type="submit"
					disabled={!isDirty}
					loading={props.isLoadingUpdate}
				/>
			)}
		</>
	);
};

// --------------------------------------------------------------------------------
// Form component that generates the matching form input component
// Internal use only
// --------------------------------------------------------------------------------

interface ZenstackFormInputProps extends ZSBaseFormProps {
	field: Field
	index: number
	customElement?: React.ReactElement
	onChange?: (event: any) => void
}

// Change from regular component to memoized component
const ZSFormInputInternal = React.memo((props: ZenstackFormInputProps) => {
	const { metadata: originalMetadata, elementMap, hooks, enumLabelTransformer } = useZenstackUIProvider();
	const metadata = props.metadataOverride || originalMetadata;

	const fields = getModelFields(metadata, props.model);

	// Get the underlying schema shape, handling both regular objects and effects
	const zodShape = useMemo(() => {
		const getSchemaShape = (schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> => {
			if ('shape' in schema) {
				return schema.shape as Record<string, z.ZodTypeAny>;
			}

			// Handle effects by getting their inner type
			if ('schema' in schema._def) {
				return getSchemaShape(schema._def.schema);
			}

			console.error('Unable to extract shape from schema:', schema);
			return {};
		};

		return getSchemaShape(props.schema);
	}, [props.schema]);

	const field = props.field;

	// Get the hook function unconditionally
	const useQueryDataHook = useMemo(() => {
		if (!field.isForeignKey) return null;
		const dataModelField = fields[field.relationField!];
		return hooks[`useFindMany${dataModelField.type}`] as UseQueryHook<any>;
	}, [field.isForeignKey, field.relationField, fields, hooks]);

	// Call the hook unconditionally (if it exists)
	const referenceFieldData = useQueryDataHook ? useQueryDataHook() : { data: null };

	// Skip hidden, foreign keys, array fields
	if (field.hidden) return null;
	if (field.isDataModel) return null;
	if (field.isArray) return null;

	// Define attributes
	let fieldType = field.type as FieldType;
	let fieldName = field.name;
	let labelData = {};
	let label = field.label || field.name;
	let zodDef = zodShape[fieldName]?._def;
	let zodFieldType = zodDef?.typeName;

	// Check for optionals, and get inner type
	let required = true;
	if (zodFieldType === 'ZodOptional') {
		required = false;
		zodDef = zodDef['innerType']['_def'];
		zodFieldType = zodDef['typeName'];
	}

	// Update attributes depending on field type
	if (zodFieldType === 'ZodEnum') {
		// Enum type - Update attributes
		fieldType = FieldType.Enum;

		// Generate base enum values
		let enumValues = zodDef['values'].map((value: any) => ({
			label: enumLabelTransformer ? enumLabelTransformer(value) : value,
			value: value,
		}));

		// Filter the enum values if a filter function exists
		if (field.filter) {
			const modelValues = props.form.getValues();
			// Fix an issue where values are strings ('undefined') instead of undefined
			Object.keys(modelValues).forEach(key => modelValues[key] === 'undefined' && (modelValues[key] = undefined));
			// Filter the enum values
			enumValues = enumValues.filter((enumItem: any) => field.filter!(modelValues, { value: enumItem.value }));
		}

		labelData = enumValues;
	} else if (field.isForeignKey) {
		// Reference type - Update attributes
		fieldType = FieldType.ReferenceSingle;
		fieldName = field.name;
		label = field.relationField!;

		// Generate label data for relation
		const dataModelField = fields[field.relationField!];
		const relationFields = getModelFields(metadata, dataModelField.type);
		const relationIdField = getIdField(relationFields);

		if (referenceFieldData?.data) {
			// Find the display field for the reference model
			// If displayFieldForReferencePicker exists, use it instead of the default id field
			const backlinkField = getModelFields(metadata, dataModelField.type);
			const backlinkIdField = getIdField(backlinkField);
			const displayField = backlinkIdField.displayFieldForReferencePicker || relationIdField.name;

			// Filter the data if a filter function exists
			let filteredData = referenceFieldData.data;
			if (field.filter) {
				const modelValues = props.form.getValues();
				// Fix an issue where values are strings ('undefined') instead of undefined
				Object.keys(modelValues).forEach(key => modelValues[key] === 'undefined' && (modelValues[key] = undefined));
				// Filter the data
				filteredData = referenceFieldData.data.filter((referenceItem: any) => field.filter!(modelValues, referenceItem));
			}

			// Generate label data
			labelData = filteredData.map((item: any) => {
				return {
					label: `${item[displayField]}`,
					value: item[relationIdField.name!],
				};
			});
		} else {
			labelData = [{ label: LOADING_PLACEHOLDER, value: LOADING_PLACEHOLDER }];
		}
	}

	// Get the appropriate element from elementMap based on field type
	const Element = elementMap[fieldType];
	const isDirty = props.type === 'update' && props.form.getDirty()[fieldName];

	// Check if field should be disabled based on dependencies
	let isDisabled = false;
	if (field.dependsOn) {
		const formValues = props.form.getValues();
		isDisabled = field.dependsOn.some(dependencyField =>
			formValues[dependencyField] === undefined
			|| formValues[dependencyField] === null,
		);
	}

	if (!Element) {
		const errorString = `No element mapping found for field ${fieldName} with type: ${field.type}`;
		console.error(errorString);
		return <div style={{ color: 'red' }} key={fieldName}>{errorString}</div>;
	}

	let placeholder = field.placeholder;
	if (props.isLoadingInitialData) placeholder = LOADING_PLACEHOLDER;

	// Create wrapped onChange handler
	// This handler is used to reset dependent fields when the main field changes (using dependsOn from metadata)
	const handleChange = (event: any) => {
		const fieldName = props.field.name;

		// Call custom element's onChange if it exists
		if (props.customElement?.props.onChange) props.customElement.props.onChange(event);
		// Call ZSFieldSlot's onChange if it exists
		if (props.onChange) props.onChange(event);

		// Call original onChange
		props.form.getInputProps(fieldName).onChange(event);

		// Find fields that depend on this field
		Object.values(fields).forEach((field) => {
			if (!field.dependsOn?.includes(fieldName)) return;

			// Get default value for the dependent field if it exists
			const defaultAttr = field.attributes?.find(attr => attr.name === '@default');
			const defaultValue = defaultAttr?.args?.[0]?.value ?? null;

			// Reset the dependent field to default or null
			props.form.setFieldValue(field.name, defaultValue);
		});
	};

	// Get form props based on field type
	// Mantine requires special handling for boolean fields
	const getFormProps = () => {
		if (fieldType === FieldType.Boolean) {
			return {
				...props.form.getInputProps(fieldName, { type: 'checkbox' }),
				required: false,
			};
		}
		return props.form.getInputProps(fieldName);
	};

	// If we have a custom element, use it instead of the element mapping
	if (props.customElement) {
		const originalClassName = props.customElement.props.className || '';
		const dirtyClassName = isDirty ? 'dirty' : '';
		const combinedClassName = `${originalClassName} ${dirtyClassName}`.trim();

		// Create base props that we want to pass
		const baseProps = {
			...getFormProps(), // Use getFormProps instead of direct getInputProps
			'onChange': handleChange,
			required,
			'key': props.form.key(fieldName),
			'className': combinedClassName,
			'disabled': isDisabled,
			'placeholder': placeholder,
			label,
			'data': labelData,
			'data-autofocus': props.index === 0,
		};

		// Filter out props that are already defined in customElement, BUT preserve className
		const finalProps = Object.fromEntries(
			Object.entries(baseProps).filter(([key]) => {
				if (key === 'onChange') return true; // Don't override onChange
				if (key === 'className') return true; // Always include className
				return props.customElement!.props[key] === undefined;
			}),
		);
		// For custom elements, we need to prioritize the loading placeholder
		if (props.isLoadingInitialData) finalProps.placeholder = LOADING_PLACEHOLDER;

		return React.cloneElement(props.customElement, finalProps);
	}

	return (
		<Element
			placeholder={placeholder}
			required={required}
			key={props.form.key(fieldName)}
			{...getFormProps()} // Use getFormProps instead of direct getInputProps
			onChange={handleChange}
			label={label}
			data={labelData}
			className={`${props.className || ''} ${isDirty ? 'dirty' : ''}`.trim()}
			disabled={isDisabled}
			data-autofocus={props.index === 0}
		/>
	);
});
ZSFormInputInternal.displayName = 'ZSFormInputInternal';

// --------------------------------------------------------------------------------
// Form customization components
// Exported for external use
// --------------------------------------------------------------------------------

/** A placeholder component will be replaced by the actual input component in the form. */
export const ZSFieldSlot = ({ fieldName, className, ...rest }: { fieldName: string, className?: string, [key: string]: any }) => {
	return <div className={className} {...rest} />;
};
const ZSFIELDSLOT_DISPLAY_NAME = 'ZenstackFormPlaceholder';
ZSFieldSlot.displayName = ZSFIELDSLOT_DISPLAY_NAME;

// Note: `fieldName` is used by `processChildren` and `hasCustomOrPlaceholder` to identify the custom field, but not inside the component itself
/** A custom element that will be controlled by the form. You do not need to pass values or data to it, but you can if you want. */
export const ZSCustomField = ({ fieldName, children }: { fieldName: string, children: React.ReactNode }) => {
	// Ensure there's exactly one child
	const childrenArray = React.Children.toArray(children);
	if (childrenArray.length !== 1 || !isValidElement(childrenArray[0])) {
		throw new Error('ZSCustomField must have exactly one child element');
	}

	return childrenArray[0];
};
const ZSCUSTOM_FIELD_DISPLAY_NAME = 'ZSCustomField';
ZSCustomField.displayName = ZSCUSTOM_FIELD_DISPLAY_NAME;

// --------------------------------------------------------------------------------
// Memoized components
// Results of automatic fields and custom fields are memoized to avoid re-renders on every form update
// Internal use only
// --------------------------------------------------------------------------------

// Rename to better describe the purpose
type AutomaticFormFieldsProps = {
	fields: Record<string, Field>
	hasCustomOrPlaceholder: (fieldName: string, children: React.ReactNode) => boolean
	children: React.ReactNode
} & Omit<ZenstackFormInputProps, 'field' | 'index' | 'customElement' | 'className'>;

const AutomaticFormFields = React.memo(({ fields, hasCustomOrPlaceholder, children, ...props }: AutomaticFormFieldsProps) => {
	return (
		<>
			{Object.values(fields).map((field, index) => {
				if (hasCustomOrPlaceholder(field.name, children)) return null;
				return (
					<ZSFormInputInternal
						key={field.name}
						field={field}
						index={index}
						{...props}
					/>
				);
			})}
		</>
	);
});
AutomaticFormFields.displayName = 'AutomaticFormFields';

interface UserDefinedFieldsProps {
	children: React.ReactNode
	processChildren: (element: React.ReactNode) => React.ReactNode
}

const UserDefinedFields = React.memo(({ children, processChildren }: UserDefinedFieldsProps) => {
	return <>{React.Children.map(children, processChildren)}</>;
});
UserDefinedFields.displayName = 'UserDefinedFields';
