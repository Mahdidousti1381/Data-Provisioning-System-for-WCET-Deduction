# 01 - Proposal and Bachelor's Thesis

This directory contains the official proposal documents and the complete, finalized Bachelor of Science thesis document for the Department of Electrical and Computer Engineering, University of Tehran.

---

## 📋 Document Overview

| Filename | Description | Format |
| :--- | :--- | :--- |
| `Bachelor_Thesis_MohammadMahdiDoustmohammadi.pdf` | Final, validated B.Sc. Thesis document (91 pages, Persian) | PDF |
| `Bachelor_Project_Proposal.pdf` | Official approved project proposal form | PDF |
| `Bachelor_Project_Proposal.docx` | Official project proposal form (Word document) | DOCX |
| `Projectday_Proposal_Revised.docx` | Project Day exhibition revised proposal document | DOCX |
| `Thesis_LaTeX_Source/` | Complete XeLaTeX source tree for compiling the thesis | LaTeX / Source |

---

## 🎓 Academic Metadata

* **University:** University of Tehran, College of Engineering
* **Faculty:** Department of Electrical and Computer Engineering
* **Degree:** Bachelor of Science in Computer Engineering
* **Author:** Mohammad Mahdi Doustmohammadi (Student ID: 810100142)
* **Supervisor:** Dr. Mehdi Kargahi
* **Thesis Title (Persian):**  
  توسعه بستر سخت‌افزاری و نرم‌افزاری استخراج و تحلیل بلادرنگ داده‌های ردگیری پردازنده بر پایه استاندارد ARM CoreSight
* **Thesis Title (English):**  
  Development of a Hardware and Software Framework for Real-Time Processor Trace Extraction and Analysis Based on the ARM CoreSight Standard

---

## 🔨 Compiling the Thesis from Source

The `Thesis_LaTeX_Source/` directory is self-contained. To compile:
1. Ensure **XeLaTeX** and Persian fonts (B Nazanin, B Titr, etc.) are installed.
2. In Windows, double-click `quick_build.bat` for rapid single-pass compilation, or `build.bat` for full multi-pass compilation (including BibTeX citations).
3. Alternatively, execute via terminal:
   ```bash
   xelatex -synctex=1 -interaction=nonstopmode main.tex
   ```
