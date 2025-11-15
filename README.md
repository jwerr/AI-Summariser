# AI-Summariser
In most meetings, people talk about many things, but not everything gets remembered. Important points, action items, or deadlines often get lost. Right now, people either take notes manually or rewatch long recordings, which wastes time. 

# Zoom Meeting Summarizer – Team 5
**Clark University – MSCS 3999 Capstone Project**

## 🚀 Project Overview
The Zoom Meeting Summarizer is a web application that automatically ingests meeting transcripts (via Zoom or manual upload) and generates:
- Structured summaries  
- Action items & deadlines  
- Google Calendar event suggestions  
- Q&A chatbot with transcript citations  
- Notifications when summaries are ready  

This helps teams save time, remember decisions, and stay organized.

---

## 👥 Team Members
- **Shivayokeshwari Athappan** – Product Owner, Backend Lead  
- **Arulprashath Rajarajan** – Scrum Master, Frontend Lead  

---

## 🛠️ Tech Stack
- **Frontend:** React + Tailwind CSS  
- **Backend:** FastAPI (Python)  
- **Database:** PostgreSQL + pgvector  
- **AI Services:** OpenAI API  
- **Integrations:** Zoom API, Google Calendar API  
- **Deployment:** Docker + Render/Fly.io  

---

## 📂 Repository Structure
zoom-meeting-summarizer/
│── frontend/ # React UI
│── backend/ # FastAPI services
│── db/ # Database migrations/schema
│── sample_code.py # Example FastAPI endpoint
│── README.md

yaml
Copy code

---

## 🔧 Setup Instructions
### 1. Clone the repository  
```bash
git clone https://github.com/YOUR-USERNAME/zoom-meeting-summarizer.git
cd zoom-meeting-summarizer
2. Create a virtual environment and install backend dependencies
bash
Copy code
python -m venv venv
source venv/bin/activate   # Linux/Mac
venv\Scripts\activate      # Windows
pip install -r requirements.txt
3. Run backend server
bash
Copy code
uvicorn backend.main:app --reload
4. Run frontend (in a new terminal)
bash
Copy code
cd frontend
npm install
npm run dev
🤝 Collaboration Guidelines
Branching model:

main → production-ready code

dev → active development

feature/* → new features

Pull requests: Each feature must be reviewed before merging.

Commit messages: Use clear, descriptive commit messages.

📅 Agile Scrum Alignment
Managed via Trello: [Insert Trello Board Link Here]

2-week sprints with planning, review, and retrospective.

Working demo at the end of each sprint.

📜 License
For academic use – Clark University MSCS 3999 Capstone Project.

