import { Divider, Textarea } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useRef } from 'react';

import { modelNames, typedModelFields } from '~client/form/form-config';
import { DetailHeader } from '~client/form/lib/detail-header';
import MZSUpdateForm from '~client/form/lib/mantine-update-form';
import { CustomRoomUpdateSchema } from '~server/schemas';
import type { ZSFormRef } from '~zenstack-ui/form/base';
import { ZSCustomField, ZSFieldSlot } from '~zenstack-ui/index';

export const Route = createFileRoute('/rooms/$id')({
	component: PeopleDetail,
});

const roomFields = typedModelFields('houseRoom');

function PeopleDetail() {
	const params = Route.useParams() as { id: string };
	const id = Number(params.id);

	// Example of useRef to get the form
	const formRef = useRef<ZSFormRef>(null);

	// Example of how to react to form changes
	const onFormChange = () => {
		console.log(formRef.current?.form.isDirty());
	};

	return (
		<div>
			<DetailHeader model={modelNames.houseRoom} id={id} route="/rooms" />
			<MZSUpdateForm onFormChange={onFormChange} formRef={formRef} model={modelNames.houseRoom} id={id} route="/rooms/$id" schemaOverride={CustomRoomUpdateSchema}>
				<Divider mt="lg" my="md" variant="dashed" />
				<div className="flex w-full gap-4">

					{/* A placeholder example. This gets replaced by an input component */}
					{/* <ZSFieldSlot className="grow" fieldName={roomFields.description} /> */}

					{/* A custom element example. This will be directly used by the form */}
					{/* <ZSCustomField fieldName={roomFields.aiSummary}>
						<Textarea
							className="grow"
							autosize
							label="AI Summary"
							placeholder="AI Summary"
						/>
					</ZSCustomField> */}

					<ZenstackTest />
				</div>
			</MZSUpdateForm>
		</div>
	);
}

/** Test to make sure wrapped components still work with ZSFieldSlot and data-field-name */
const ZenstackTest = () => {
	return (
		<>
			{/* A placeholder example. This gets replaced by an input component */}
			{/* You can also pass custom class and event handlers if needed */}
			<ZSFieldSlot
				onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
					console.log('custom onChange', event.target.value);
				}}
				className="grow"
				fieldName={roomFields.description}
			/>

			{/* A custom element example. This will be directly used by the form */}
			<ZSCustomField fieldName={roomFields.aiSummary}>
				<Textarea
					className="grow"
					autosize
					label="AI Summary"
					placeholder="AI Summary"
				/>
			</ZSCustomField>
		</>
	);
};
