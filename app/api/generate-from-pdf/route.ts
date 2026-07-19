import { NextRequest, NextResponse } from 'next/server';
import { google, type GoogleLanguageModelOptions } from '@ai-sdk/google';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { Client } from "@gradio/client";

interface TestObject {
    gender: 'male' | 'female';
    age: number;
    bmi: number;
    glucose: number;
}

export async function POST(req: NextRequest) {
  try {
    // Parse the form data to retrieve the file
    const formData = await req.formData();
    const fileField = formData.get('file');

    if (!fileField) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!(fileField instanceof File)) {
      return NextResponse.json({ error: 'Invalid file provided.' }, { status: 400 });
    }

    // Convert the uploaded file (a Blob) to a Node.js Buffer
    const arrayBuffer = await fileField.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const mimeType = fileField.type; // Expected to be 'application/pdf'

    const responseSchema = z.object({
        gender: z.enum(["male", "female"]),
        age: z.number(),
        vitals: z.object({
          blood_pressure_sys: z.number(),
          blood_pressure_dia: z.number(),
          heart_rate: z.number(),
          respiratory_rate: z.number(),
          temp: z.number(),
          weight: z.number(),
          height: z.number(),
          bmi: z.number(),
        }),
        lab_tests: z.record(
          z.object({
            results: z.record(z.number()),
          })
        ),
      }).strict();

    // Create the generative model with a system instruction including the JSON schema
    const model = google('gemini-2.0-flash');

    // Generate text using the model. The user message only contains the file.
    const result = await generateObject({
      model,
      schema: responseSchema,
      providerOptions: {
        google: {
          structuredOutputs: false,
        } satisfies GoogleLanguageModelOptions,
      },
      system: `Parse the uploaded document with the JSON schema provided.

Group results that are under the same test, for instance:

  "lab_tests": [
    {
      "test_name": "Glucose Metabolism",
      "results": [
        {
          "result_name": "Fasting Blood Glucose",
          "result_value": 128
        },
        {
          "result_name": "HbAlc",
          "result_value": 7.2
        }
      ]
    }
  ]
`,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: "Parse the document."},
            { type: 'file', data: fileBuffer, mediaType: mimeType },
          ],
        },
      ],
    });


    const testObject: TestObject = {
        gender: result.object.gender,
        age: result.object.age,
        bmi: result.object.vitals.bmi,
        glucose: result.object.lab_tests["Glucose Metabolism"].results["Fasting Blood Glucose"]
    };
    const client = await Client.connect("ChemicalDaniel/SmartCareAI");
    const result2 = await client.predict("/predict", { 		
            input_json: JSON.stringify(testObject), 
    });
    const predictionArray = JSON.parse(result2.data[0]);
    return NextResponse.json(predictionArray);
  } catch (error) {
    console.error('Error processing PDF:', error);
    return NextResponse.json(
      { error: 'An error occurred while processing the PDF.' },
      { status: 500 }
    );
  }
}
