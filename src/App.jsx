import React, { useState, useEffect } from 'react';
import OpenAI from 'openai';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import './App.css';

// Configure PDF.js worker
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;

export default function App() {
  const [pdfText, setPdfText] = useState('');
  const [error, setError] = useState('');
  const [imageFiles, setImageFiles] = useState([]);
  const [websiteData, setWebsiteData] = useState('');
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');
  const [displayedResponse, setDisplayedResponse] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showUploadSection, setShowUploadSection] = useState(true);
  const [websiteFetched, setWebsiteFetched] = useState(false);
  const [showGoToUploadButton, setShowGoToUploadButton] = useState(false); // New state variable

  // Word by word rendering effect
  useEffect(() => {
    if (aiResponse && currentIndex < aiResponse.length) {
      const timer = setTimeout(() => {
        setDisplayedResponse((prev) => prev + aiResponse[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
      }, 5); // Adjust speed as needed

      return () => clearTimeout(timer);
    }
  }, [aiResponse, currentIndex]);

  // Handle PDF upload
  const handlePdfUpload = async (e) => {
    const files = Array.from(e.target.files);

    for (const file of files) {
      if (file.type === 'application/pdf') {
        setError('');
        const fileUrl = URL.createObjectURL(file);
        await extractTextFromPdf(fileUrl);
      } else {
        setError('Please upload a valid PDF file.');
      }
    }
  };

  // Handle image upload
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        setError('');
        setImageFiles((prev) => [...prev, file]);
      } else {
        setError('Please upload a valid image file.');
      }
    }
  };

  // Extract text from PDF
  const extractTextFromPdf = async (url) => {
    try {
      const pdf = await getDocument(url).promise;
      let text = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        text += textContent.items.map((item) => item.str).join(' ') + '\n';
      }

      setPdfText(text);
    } catch (err) {
      setError('Failed to extract text from the PDF.');
      console.error("PDF extraction error:", err);
    }
  };

  // Fetch website text content
  const fetchWebsiteText = async (url) => {
    try {
      const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
      const response = await fetch(proxyUrl + url);

      if (!response.ok) {
        throw new Error('Failed to fetch data from the website');
      }

      const htmlContent = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      const textContent = doc.body.innerText || doc.body.textContent;

      setWebsiteData(textContent);
      setWebsiteFetched(true);
    } catch (error) {
      setError('Error fetching data: ' + error.message);
    }
  };

  // Handle URL submission
  const handleUrlSubmit = () => {
    if (!url) {
      setError('Please enter a valid URL.');
      return;
    }
    fetchWebsiteText(url);
  };

  // Convert image files to base64
  const convertImageToBase64 = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Send data to OpenAI
  const sendDataToOpenAI = async () => {
    const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

    if (!OPENAI_API_KEY) {
      setError('OpenAI API key not configured. Please add it to your environment variables.');
      return;
    }

    setIsLoading(true);
    setShowUploadSection(false);
    setDisplayedResponse('');
    setCurrentIndex(0);

    try {
      const openai = new OpenAI({
        apiKey: OPENAI_API_KEY,
        dangerouslyAllowBrowser: true,
      });

      const imageContents = await Promise.all(
        imageFiles.map(async (file) => ({
          type: "image_url",
          image_url: {
            url: `data:${file.type};base64,${await convertImageToBase64(file)}`,
          },
        }))
      );

      const textContent = {
        type: "text",
        text: `Please analyze the following content:
        Website Data: ${websiteData}
        Resume (PDF Text): ${pdfText}

        Based on the website data, resume, and the images provided, please answer the questions in the image as if you are the person from the resume. The image has job-related questions for a company. The website data is about the company, and you need to answer as a job applicant using context from the resume.

        Provide the questions and answers in the following JSON format. Strictly return a JSON object without any additional text:

        {
          "qaPair": [
            { "index": 0, "question": "What are your skills?", "answer": "I am proficient in React and backend development." },
            { "index": 1, "question": "Why do you want to join us?", "answer": "Your company's vision aligns with my goals." }
          ]
        }

        Return only the JSON object above.`,
      };

      const content = [...imageContents, textContent];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that analyzes resumes, website content, and images to provide relevant insights.",
          },
          {
            role: "user",
            content: content,
          },
        ],
        max_tokens: 1000,
      });

      const responseText = completion.choices[0].message.content;

      // Extract JSON using regex
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Response does not contain valid JSON.");
      }

      const parsedResponse = JSON.parse(jsonMatch[0]); // Parse extracted JSON

      if (parsedResponse.qaPair) {
        setAiResponse(parsedResponse.qaPair);
      } else {
        throw new Error("AI response does not contain 'qaPair'.");
      }

    } catch (err) {
      setError(`Error contacting OpenAI: ${err.message}`);
      console.error('OpenAI request error:', err);
    } finally {
      setIsLoading(false);
      setShowGoToUploadButton(true); // Show the button after API response
    }
  };

  // Handle copying individual answers
  const handleCopyAnswer = (answer) => {
    navigator.clipboard.writeText(answer).then(
      () => alert("Copied to clipboard!"),
      (err) => alert("Failed to copy: " + err)
    );
  };

  return (
    <div className="app">
      <h1>Job Helper</h1>

      {showUploadSection && (
        <div className="upload-container">
          <div className="upload-section">
            <h2>Upload Resume PDF</h2>
            <label htmlFor="resume">Upload Resume</label>
            <input type="file" accept="application/pdf" onChange={handlePdfUpload} id="resume" />
          </div>

          <div className="upload-section">
            <h2>Upload Questions Image</h2>
            <label htmlFor="image">Upload Image</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} multiple id="image" />
          </div>

          <div className="url-container">
            <h2>Enter Company Website URL</h2>
            <input 
              type="text" 
              placeholder="Enter website URL" 
              value={url} 
              onChange={(e) => setUrl(e.target.value)} 
            />
            <button onClick={handleUrlSubmit}>
              {websiteFetched ? 'Fetched' : 'Fetch Website Text'}
            </button>
          </div>

          <div className="submit-container">
            <button onClick={sendDataToOpenAI} disabled={isLoading}>
              {isLoading ? 'Processing...' : 'Get Answer'}
            </button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="processing-text">
          <p>Processing Answer... Please wait.</p>
        </div>
      )}

      {!isLoading && aiResponse.length > 0 && (
        <div className="ai-response">
          <h3>Answers:</h3>
          {aiResponse.map((qaPair, index) => (
            <div key={index} className="qa-pair">
              <p>
                <strong>Q{index + 1}: </strong>
                {qaPair.question}
              </p>
              <p>
                <strong>A{index + 1}: </strong>
                {qaPair.answer}
              </p>
              <button onClick={() => handleCopyAnswer(qaPair.answer)}>
                Copy Answer
              </button>
            </div>
          ))}
        </div>
      )}

      {showGoToUploadButton && (
        <div className="go-to-upload">
          <button onClick={() => {
      setShowUploadSection(true);
      setAiResponse(''); // Clear the AI response
      setDisplayedResponse(''); // Clear the displayed response
      setCurrentIndex(0); // Reset the current index for word-by-word rendering
      setShowGoToUploadButton(false); // Hide the "Go to Upload" button
    }}>
      Go to Upload
    </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
